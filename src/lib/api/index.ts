import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";
import { goto } from "$app/navigation";
import { toast } from "svelte-sonner";
import z from "zod";

import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
import { isLocked } from "$lib/app-data/app-lock.svelte";
import { fromBase64, toBase64 } from "$lib/base64";

export const methods = {
	login: {
		request: z.object({
			email: z.email(),
			password: z.string().min(1),
		}),
		response: z.object({
			profileId: z.coerce.number().int().nonnegative(),
		}),
	},
	// BREAKING IPC CHANGE (Rust `auth.rs`): `auth_state` used to return a bare
	// `Option<u64>` profile id. It now returns `AuthStateResponse`
	// (`#[serde(rename_all = "camelCase")]`), i.e.
	// `{ profileId: number | null, keyringError: string | null }`.
	//
	// `keyringError` is `Some(reason)` when secure storage is unusable, which
	// means login can NEVER succeed in this process. Previously there was no way
	// to tell that apart from "not logged in", so the app looped "login failed"
	// forever with no diagnosis. Consumers MUST surface it
	// (`hooks.client.ts`, `routes/(protected)/+layout.ts`, `routes/auth/+layout.ts`).
	auth_state: {
		request: z.undefined(),
		response: z.object({
			profileId: z.number().int().nonnegative().nullable(),
			keyringError: z.string().nullable(),
		}),
	},
	rotate_api_params: {
		request: z.undefined(),
		response: z.object({
			"user-agent": z.string(),
			"l-device-info": z.string(),
		}),
	},
	logout: {
		request: z.undefined(),
		response: z.undefined(),
	},
	forgot_password: {
		request: z.object({
			email: z.email(),
		}),
		response: z.undefined(),
	},
} satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

/**
 * Shown when `auth_state` reports unusable secure storage.
 *
 * A non-null `keyringError` means `storage::init_keyring` never installed a
 * store, so every `Entry::new` returns `NoStore` forever: login can NEVER
 * succeed in this process. A plain "login failed" retry loop is therefore
 * useless and, worse, is exactly what the user was shown before `auth_state`
 * grew this field — a permanent loop with no diagnosis. Exported from the module
 * that owns the `auth_state` schema so the client hook and both root layouts
 * show one identical, actionable string.
 */
export const KEYRING_ERROR_MESSAGE =
	"GrindrX can't reach Android's secure storage, so signing in is impossible in this install. Clear GrindrX's app storage (or reinstall) and try again.";

export async function callMethod<T extends keyof typeof methods>(
	method: T,
	...args: z.infer<(typeof methods)[T]["request"]> extends undefined
		? []
		: [data: z.infer<(typeof methods)[T]["request"]>]
): Promise<z.infer<(typeof methods)[T]["response"]>> {
	const result = await invoke<z.infer<(typeof methods)[T]["response"]>>(
		method,
		args[0],
	);
	// Any command that comes back with a live session proves the auth-failure
	// redirect latch (below) is stale, so clear it here instead of making the
	// user sign out/in by hand to un-stick it. Read through a narrowing helper
	// because `T` is generic, so the result type is not statically known here.
	if (method === "login" || hasLiveSession(result)) {
		authRedirectLatched = false;
	}
	return result;
}

/** True when a command result carries a non-null `profileId`. */
function hasLiveSession(result: unknown): boolean {
	if (typeof result !== "object" || result === null) return false;
	const { profileId } = result as { profileId?: unknown };
	return typeof profileId === "number";
}

export function asAppError(error: unknown) {
	const { data, success } = z
		.object({
			kind: z.enum(["Http", "Auth", "Api", "NotInitialized"]),
			message: z
				.string()
				.or(
					z.object({
						code: z.number(),
						message: z.string(),
					}),
				)
				.optional(),
		})
		.safeParse(error);
	if (success) {
		let prettyMessage: string;
		if (typeof data.message === "string") {
			prettyMessage = data.message;
		} else if (data.message) {
			prettyMessage = `Error ${data.message.code}: ${data.message.message}`;
		} else {
			prettyMessage = "An unknown error occurred";
		}
		return { ...data, prettyMessage };
	}
}

/**
 * Raised when the backend relays a non-2xx HTTP response. The Grindr REST API
 * normally returns a JSON error envelope (`{ code, message }`), but some
 * endpoints — notably the cascade/explore grid — answer with a bare text code
 * such as `CAS-4001`. This class normalises both shapes so callers receive the
 * HTTP status and the server code instead of a `JSON.parse` SyntaxError
 * ("Unexpected token 'C', \"CAS-4001\" is not valid JSON").
 *
 * `.message` is USER-FACING (it reaches toasts) and is therefore built only
 * from the status plus the server's own `message`/`code` field. The raw body is
 * kept verbatim in `.body` for LOGS and diagnostics — never interpolated into
 * the message, because these bodies can be HTML error pages, WAF interstitials
 * and other content that must not be shown to a user. Callers that need to
 * branch on the failure use `isApiHttpError(err, status)` from `$lib/api/http`,
 * never a regex over `.message`.
 *
 * `path` also reaches `.message`, so pass one WITHOUT user identifiers.
 */
export class ApiHttpError extends Error {
	/** HTTP status of the relayed response. */
	readonly status: number;
	/** Raw response body, verbatim. FOR LOGS/DEBUGGING ONLY — not user-facing. */
	readonly body: string;
	/** Decoded `{ code }` from the JSON envelope, or a short bare server code. */
	readonly code: string | number | null;

	constructor(status: number, body: string, path: string) {
		const trimmed = body.trim();
		let code: string | number | null = null;
		let serverMessage: string | null = null;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (parsed && typeof parsed === "object") {
				const obj = parsed as Record<string, unknown>;
				if (typeof obj.code === "string" || typeof obj.code === "number") {
					code = obj.code;
				}
				if (typeof obj.message === "string") {
					serverMessage = obj.message;
				}
			}
		} catch {
			// Not JSON — treat a short body as a bare error code (e.g. "CAS-4001").
			if (trimmed && trimmed.length <= 64) {
				code = trimmed;
			}
		}
		// Only the server's own `message`/`code` is allowed into the
		// user-facing string. The previous `?? trimmed.slice(0, 120)` fallback
		// pasted the first 120 characters of an arbitrary body (an HTML error
		// page, a WAF interstitial) straight into a toast.
		const detail = serverMessage ?? (code != null ? String(code) : null);
		super(
			`Request to ${path} failed (HTTP ${status}${detail ? `: ${detail}` : ""})`,
		);
		this.name = "ApiHttpError";
		this.status = status;
		this.body = body;
		this.code = code;
	}
}

/**
 * Decides what a REST response body actually IS before anything tries to
 * `JSON.parse` it. Pulled out of `fetchRest`'s `json()` closure (and exported)
 * so the CAS-4001 / Cloudflare-block decision points behind the explore grid
 * (Tom issue #2) and `requestBlockedAlertState` are independently testable —
 * previously they only had indirect coverage through `ApiHttpError`.
 *
 * - "cloudflare-block": a 403 carrying Cloudflare's "you have been blocked"
 *   interstitial HTML, not a real API response.
 * - "error-code": a non-2xx status, OR a 2xx body that isn't valid JSON but is
 *   short/shaped like a bare server code (e.g. the cascade/explore grid's
 *   `CAS-4001`). Callers should raise `ApiHttpError`.
 * - "json": a 2xx body that parses as JSON.
 * - "parse-error": a 2xx body that is neither valid JSON nor code-shaped — a
 *   genuine, unexpected parse failure worth logging.
 */
export type ResponseBodyClassification =
	| "cloudflare-block"
	| "error-code"
	| "json"
	| "parse-error";

export function classifyResponseBody(
	status: number,
	text: string,
): ResponseBodyClassification {
	// Cloudflare fronts the API and refuses requests with an HTML interstitial
	// of one of SEVERAL templates. Matching two literals from a single template
	// (the previous `=== 403 && includes("<title>Attention Required! | Cloudflare
	// </title>") && includes("Sorry, you have been blocked")`) meant any other
	// template — a managed JS challenge, a rate-limit interstitial, a different
	// locale — fell through to "error-code", so the user saw "Couldn't load
	// profiles" with no code and never got the "request blocked" dialog that
	// exists for exactly this case. Observed live: two probes minutes apart hit
	// two different templates.
	//
	// Deliberately template-agnostic: a 403/429 whose body is NOT JSON is a
	// refusal by definition, and "cloudflare" appearing anywhere in it confirms
	// the source. We do not try to tell a WAF block from a rate limit from a
	// challenge — the app cannot act differently on each today, and guessing
	// wrong is what produced the misleading message in the first place.
	const looksLikeHtmlInterstitial =
		(status === 403 || status === 429) &&
		!/^\s*[[{]/.test(text) &&
		/cloudflare|attention required|just a moment|enable javascript and cookies|checking your browser|ray id/i.test(
			text,
		);
	if (looksLikeHtmlInterstitial) {
		return "cloudflare-block";
	}
	// A non-2xx body is an ERROR payload, not the success schema. It may be
	// Grindr's JSON envelope ({ code, message }) or — for the cascade/explore
	// grid — a bare code like `CAS-4001`. Parsing it as the success shape
	// yields a useless "Unexpected token …" instead of the real failure, so
	// callers raise a structured error carrying the status instead.
	const isErrorStatus = status < 200 || status >= 300;
	if (isErrorStatus) {
		return "error-code";
	}
	try {
		JSON.parse(text);
		return "json";
	} catch {
		// The cascade/explore endpoint can answer 200 with a bare code (e.g.
		// `CAS-4001`) instead of JSON — the free-tier / rate limit / region-
		// restriction signal. On a 2xx a short, non-JSON body is therefore a
		// server error code, not a real parse failure.
		const trimmed = text.trim();
		const looksLikeCode =
			trimmed.length > 0 &&
			(trimmed.length <= 64 || /^[A-Z]+-\d+$/.test(trimmed));
		return looksLikeCode ? "error-code" : "parse-error";
	}
}

/**
 * The one entry point for every REST call.
 *
 * BODY ENCODING: pass `options.body` as a plain object. It is msgpack-encoded
 * ONCE here and the Rust bridge decodes it into a `serde_json::Value` before
 * re-serialising it as the outgoing JSON body (`src-tauri/src/api/rest.rs`).
 * A pre-`JSON.stringify`'d body therefore becomes a JSON *string literal* on
 * the wire instead of an object, so the server never parses its fields — see
 * the identical note in `$lib/api/taps`. The outer envelope (method/path/body)
 * is msgpack-encoded and base64'd because of tauri#10573.
 *
 * TIMEOUT/CANCELLATION: there is deliberately no JS-side `AbortController` or
 * `Promise.race` timer. The WebView cannot cancel an in-flight `invoke` (the
 * Tauri IPC bridge has no cancellation channel), so a client-side timer would
 * only stop *awaiting* a request the backend keeps running. Cancellation is
 * already enforced one layer down, where it is real: `GrindrClient` is built
 * with `reqwest::Client::builder().timeout(30s).connect_timeout(10s)` in
 * `src-tauri/src/api/client.rs`, so every call this function makes is already
 * bounded and fails on its own.
 *
 * HTTP FAILURE: a non-2xx status does NOT reject here — it RESOLVES, and
 * `.json()` / `.jsonParsed()` raises `ApiHttpError` (see `classifyResponseBody`).
 * Callers that never read the body must call `throwForStatus(res, path)` from
 * `$lib/api/http` instead of string-concatenating the response.
 */
export async function fetchRest(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		// Route through the UNAUTHENTICATED backend bridge (`request_public`) for
		// pre-session endpoints — account creation, forgot-password. The default
		// authed bridge would reject a logged-out caller with "Not logged in"
		// before the network call, which the catch below turns into a sign-in
		// redirect — wrong for a user who is deliberately signed out. Also
		// excludes these calls from the session-lost redirect entirely.
		public?: boolean;
	} = { method: "GET" },
) {
	try {
		const payload = encode({
			method: options.method || "GET",
			path,
			body: options.body === undefined ? null : encode(options.body),
		});
		const packed = await invoke(options.public ? "request_public" : "request", {
			// https://github.com/tauri-apps/tauri/issues/10573
			payload: toBase64(payload),
		}).then((res) => {
			if (typeof res === "string") {
				// https://github.com/tauri-apps/tauri/issues/10573
				return fromBase64(res);
			} else {
				throw new Error("Invalid response from backend");
			}
		});
		const decoded: unknown = decode(packed);
		const { status, body: responseBody } = z
			.object({ status: z.number(), body: z.instanceof(Uint8Array) })
			.parse(decoded);
		// A server-side 401 arrives as a RESOLVED response, so it can never
		// reach the `catch` below — the old code only ever noticed a dead
		// session on the token-refresh path, leaving a revoked/expired session
		// rendering stale grids and a dead chat. Caught here, centrally, for
		// every call site at once.
		if (!options.public && status === 401) {
			handleSessionLost();
		}
		return {
			status,
			bytes() {
				return responseBody;
			},
			text() {
				return new TextDecoder().decode(this.bytes());
			},
			json(): unknown {
				const text = this.text();
				const classification = classifyResponseBody(this.status, text);
				if (classification === "cloudflare-block") {
					if (!requestBlockedAlertState.disable) {
						requestBlockedAlertState.open = true;
					}
					throw new Error("Request blocked");
				}
				if (classification === "error-code") {
					// Structured error carrying the status + decoded code (Grindr's
					// JSON envelope or a bare code like `CAS-4001`) instead of a
					// useless "Unexpected token …" parse error.
					throw new ApiHttpError(this.status, text, path);
				}
				if (classification === "parse-error") {
					console.error("Failed to parse JSON response", {
						path,
						text,
					});
				}
				// "json" parses cleanly; "parse-error" re-runs JSON.parse to surface
				// the real SyntaxError (matching prior behavior) after the
				// diagnostic log above.
				return JSON.parse(text);
			},
			jsonParsed<TSchema extends z.ZodType>(schema: TSchema) {
				const data: unknown = this.json();
				return parseApiResponse({
					schema,
					data,
					path,
					method: options.method || "GET",
				});
			},
		};
	} catch (error) {
		// A pre-session call must never be answered with a sign-in redirect:
		// the user is already on the sign-in page (that is where these are
		// called from), and redirecting there is a no-op loop.
		if (!options.public && isSessionGone(error)) {
			handleSessionLost(error);
		}
		throw error;
	}
}

/**
 * Latch for the sign-in redirect.
 *
 * `fetchRest` is called concurrently from many places — the grid, the
 * conversations list, and the 10s reconcile poll all fire at once — and every
 * one of them rejected with `{ kind: "Auth", message: "Not logged in" }`
 * produced its OWN `toast("Please log in to continue")` and its OWN
 * `goto("/auth/sign-in")`. The user saw N stacked toasts and the router raced N
 * navigations. One flag makes it exactly one of each.
 */
let authRedirectLatched = false;

/**
 * Separate one-shot for the "deferred because locked" warning, so that a
 * deferred redirect can still happen: `authRedirectLatched` must stay `false`
 * while locked, or the first request after unlock would find the latch set and
 * never navigate at all.
 */
let lockDeferralWarned = false;

/**
 * True when `error` means "this session is gone", for BOTH ways the backend can
 * say it:
 *   - the bridge refusing the call outright (`AppError::Auth("Not logged in")`),
 *   - the server actually answering HTTP 401.
 *
 * The 401 case is the one that was silently dropped: a server-side 401 arrives
 * as a resolved response, so session deletion only ever happened on the refresh
 * path and a revoked/expired session left the UI showing stale grids and a dead
 * chat until the next token refresh. Note that a *secure-storage* failure is
 * also `AppError::Auth`, but it is only ever raised by `login`/`refresh_token`
 * (which go through `callMethod`, never `fetchRest`) — and it is reported
 * separately as `auth_state`'s `keyringError`, so it cannot cause this loop.
 */
function isSessionGone(error: unknown): boolean {
	const appError = asAppError(error);
	if (!appError) return false;
	if (appError.kind === "Auth") return true;
	if (appError.kind === "Api" && typeof appError.message === "object") {
		return appError.message?.code === 401;
	}
	return false;
}

/** Exposed for tests: clear the one-shot sign-in redirect. */
export function resetAuthRedirectLatch(): void {
	authRedirectLatched = false;
	lockDeferralWarned = false;
}

/**
 * Tear down client-side session state and, at most once, send the user to
 * sign-in.
 *
 * WHILE THE APP LOCK IS ENGAGED this is a NO-OP beyond rethrowing. `PinLockGate`
 * lives in `(protected)/+layout.svelte`, so navigating to `/auth` unmounts the
 * lock screen entirely — which means an auth failure raised while the PIN screen
 * is up used to navigate the user *out of the lock and into a form*, showing
 * them their inbox state in the process. The gate's `beforeNavigate` cancel is
 * a backstop; the redirect itself must not fire. (Root-cause note recorded in
 * `PinLockGate.svelte`.) The error is still thrown, so the state that fetched
 * it records its own failure, and the redirect happens normally on the first
 * request after the user unlocks.
 */
function handleSessionLost(error?: unknown): void {
	if (isLocked()) {
		// Deliberately does NOT set `authRedirectLatched`: the redirect has to
		// still be pending when the user unlocks.
		if (!lockDeferralWarned) {
			lockDeferralWarned = true;
			console.warn(
				"[GrindrX] Session is gone but the app lock is engaged; deferring the " +
					"sign-in redirect until after unlock.",
			);
		}
		return;
	}
	if (authRedirectLatched) return;
	authRedirectLatched = true;
	lockDeferralWarned = false;

	toast("Please log in to continue");
	// `error` is the bridge's own AppError when the call was refused, or
	// undefined for a bare HTTP 401. Neither carries credentials.
	console.warn("[GrindrX] Session gone; redirecting to sign-in.", error ?? "");
	// Drop everything derived from the dead session BEFORE navigating, so no
	// stale frame renders behind the sign-in page. All dynamic: `$lib/api/*`
	// imports `$lib/api` itself, so a static import here would be a cycle.
	void Promise.allSettled([
		import("$lib/api/profile").then((m) => m.clearMediaIdCache()),
		import("$lib/api/genders").then((m) => m.clearGendersCache()),
		import("$lib/api/pronouns").then((m) => m.clearPronounsCache()),
		// The socket is authenticated with the same dead session; leave it
		// connected and it just fails to authenticate on the Rust side.
		import("$lib/ws.svelte").then((m) => m.ws.disconnect()),
	]);
	goto("/auth/sign-in").catch((e: unknown) => console.error(e));
}

export function parseApiResponse<TSchema extends z.ZodType>(options: {
	schema: TSchema;
	data: unknown;
	path: string;
	method?: string;
}): z.infer<TSchema> {
	const parsed = options.schema.safeParse(options.data);
	if (parsed.success) {
		return parsed.data;
	}

	console.error(
		"API response schema validation failed " +
			JSON.stringify({
				path: options.path,
				method: options.method ?? "GET",
				issues: parsed.error.issues.slice(0, 10),
			}),
	);

	throw parsed.error;
}
