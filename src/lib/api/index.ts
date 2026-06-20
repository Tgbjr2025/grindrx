import { decode, encode } from "@msgpack/msgpack";
import { invoke } from "@tauri-apps/api/core";
import { goto } from "$app/navigation";
import { toast } from "svelte-sonner";
import z from "zod";

import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
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
	auth_state: {
		request: z.undefined(),
		response: z.number().int().nonnegative().nullable(),
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
} satisfies Record<string, { request: z.ZodType; response: z.ZodType }>;

export async function callMethod<T extends keyof typeof methods>(
	method: T,
	...args: z.infer<(typeof methods)[T]["request"]> extends undefined
		? []
		: [data: z.infer<(typeof methods)[T]["request"]>]
): Promise<z.infer<(typeof methods)[T]["response"]>> {
	return await invoke(method, args[0]);
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
 */
export class ApiHttpError extends Error {
	readonly status: number;
	readonly body: string;
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
		const detail =
			serverMessage ?? (code != null ? String(code) : trimmed.slice(0, 120));
		super(
			`Request to ${path} failed (HTTP ${status}${detail ? `: ${detail}` : ""})`,
		);
		this.name = "ApiHttpError";
		this.status = status;
		this.body = body;
		this.code = code;
	}
}

export async function fetchRest(
	path: string,
	options: {
		method?: string;
		body?: unknown;
	} = { method: "GET" },
) {
	try {
		const payload = encode({
			method: options.method || "GET",
			path,
			body: options.body === undefined ? null : encode(options.body),
		});
		const packed = await invoke("request", {
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
		const decoded = decode(packed);
		const { status, body: responseBody } = z
			.object({ status: z.number(), body: z.instanceof(Uint8Array) })
			.parse(decoded);
		return {
			status,
			bytes() {
				return responseBody;
			},
			text() {
				return new TextDecoder().decode(this.bytes());
			},
			json() {
				const text = this.text();
				if (
					this.status === 403 &&
					text.includes("<title>Attention Required! | Cloudflare</title>") &&
					text.includes("Sorry, you have been blocked")
				) {
					if (!requestBlockedAlertState.disable) {
						requestBlockedAlertState.open = true;
					}
					throw new Error("Request blocked");
				}
				// A non-2xx body is an ERROR payload, not the success schema. It may
				// be Grindr's JSON envelope ({ code, message }) or — for the
				// cascade/explore grid — a bare code like `CAS-4001`. Parsing it as
				// the success shape yields a useless "Unexpected token …" instead of
				// the real failure, so raise a structured error carrying the status.
				if (this.status < 200 || this.status >= 300) {
					throw new ApiHttpError(this.status, text, path);
				}
				try {
					return JSON.parse(text);
				} catch (error) {
					console.error("Failed to parse JSON response", {
						path,
						text,
					});
					throw error;
				}
			},
			jsonParsed<TSchema extends z.ZodType>(schema: TSchema) {
				const data = this.json();
				return parseApiResponse({
					schema,
					data,
					path,
					method: options.method || "GET",
				});
			},
			debugJsonParsed<TSchema extends z.ZodType>(schema: TSchema) {
				console.log(this.json());
				return this.jsonParsed(schema);
			},
		};
	} catch (error) {
		const appError = asAppError(error);
		if (appError) {
			if (appError.kind === "Auth" && appError.message === "Not logged in") {
				toast("Please log in to continue");
				goto("/auth/sign-in").catch((error) => console.error(error));
				throw new Error("Auth required");
			}
		}
		throw error;
	}
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
