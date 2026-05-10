import z from "zod";
import { invoke } from "@tauri-apps/api/core";
import { decode, encode } from "@msgpack/msgpack";
import { goto } from "$app/navigation";
import toast from "svelte-french-toast";

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

export async function fetchRest(
	path: string,
	options: {
		method?: string;
		body?: unknown;
		abortController?: AbortController;
	} = { method: "GET" },
) {
	try {
		const payload = encode({
			method: options.method || "GET",
			path,
			body: options.body === undefined ? null : encode(options.body),
		});
		const packed = await invoke("request", payload).then((res) =>
			z.instanceof(ArrayBuffer).parse(res),
		);
		if (options.abortController?.signal.aborted) {
			throw new Error("Request aborted");
		}
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
				return JSON.parse(this.text());
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
		};
	} catch (error) {
		const appError = asAppError(error);
		if (appError) {
			if (appError.kind === "Auth" && appError.message === "Not logged in") {
				toast("Please log in to continue");
				goto("/auth/sign-in");
			}
		}
		throw error;
	}
}

export function parseApiResponse<TSchema extends z.ZodType>(
	options: {
		schema: TSchema;
		data: unknown;
		path: string;
		method?: string;
	},
): z.infer<TSchema> {
	const parsed = options.schema.safeParse(options.data);
	if (parsed.success) {
		return parsed.data;
	}

	console.error("API response schema validation failed", {
		path: options.path,
		method: options.method ?? "GET",
		schema: options.schema.meta()?.title,
		issues: parsed.error.issues,
		response: options.data,
	});

	throw parsed.error;
}
