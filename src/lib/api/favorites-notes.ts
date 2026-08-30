import z from "zod";

import { ApiHttpError, fetchRest } from "$lib/api";

// GET/PUT/DELETE /v1/favorites/notes/{targetProfileId} — Grindr's private,
// per-favorite note + phone number (see docs: grindr-api/users/favorites#get-note
// / #add-note / #delete-note). Distinct from the favorites list itself, which is
// derived from the cascade grid with `favorites=true`.

export type FavoriteNote = {
	notes: string;
	phoneNumber: string;
};

// Tolerant single-note schema. The server documents `notes`/`phoneNumber` as
// always-present strings, but we never want a missing/null field (or an empty
// 204-style body decoded to `{}`) to throw — a nonexistent note is a normal
// state that should read back as empty strings. `.catch("")` collapses any
// unexpected shape for a field down to "" while still preferring a real string.
const favoriteNoteSchema = z
	.object({
		notes: z.string().catch(""),
		phoneNumber: z.string().catch(""),
	})
	.catch({ notes: "", phoneNumber: "" });

/**
 * Tolerant, network-free parser for a single-note payload. Exported so the
 * empty/missing/malformed-field tolerance can be unit-tested without a live
 * server (see favorites-notes.test.ts). Always returns both fields as strings,
 * defaulting to "" for anything the server omitted or sent in the wrong shape.
 */
export function parseNote(raw: unknown): FavoriteNote {
	const parsed = favoriteNoteSchema.safeParse(raw);
	if (parsed.success) {
		return { notes: parsed.data.notes, phoneNumber: parsed.data.phoneNumber };
	}
	return { notes: "", phoneNumber: "" };
}

const NOTES_PATH = "/v1/favorites/notes";

/**
 * GET /v1/favorites/notes/{targetProfileId}. Returns the note + phone number for
 * a single favorite, defaulting to empty strings when the profile has no note
 * (the documented "empty for nonexistent notes" case) or the field is missing.
 */
export async function getFavoriteNote(profileId: number): Promise<FavoriteNote> {
	const res = await fetchRest(`${NOTES_PATH}/${profileId}`, { method: "GET" });
	if (res.status >= 400) {
		throw new ApiHttpError(res.status, res.text(), `${NOTES_PATH}/${profileId}`);
	}
	// Parse defensively via `parseNote` rather than `jsonParsed`: an empty note
	// can come back as `{}` (or an empty body), which the tolerant schema turns
	// into empty strings instead of throwing.
	let data: unknown;
	try {
		data = res.json();
	} catch {
		data = {};
	}
	return parseNote(data);
}

/**
 * PUT /v1/favorites/notes/{targetProfileId}. Both `notes` and `phoneNumber` are
 * required by the server, so `phoneNumber` defaults to "". Responds with an
 * empty 204 body on success, so this only inspects the status.
 */
export async function setFavoriteNote(
	profileId: number,
	{ notes, phoneNumber = "" }: { notes: string; phoneNumber?: string },
): Promise<void> {
	const path = `${NOTES_PATH}/${profileId}`;
	const res = await fetchRest(path, {
		method: "PUT",
		body: { notes, phoneNumber },
	});
	if (res.status >= 400) {
		throw new ApiHttpError(res.status, res.text(), path);
	}
}

/**
 * DELETE /v1/favorites/notes/{targetProfileId}. Clears the note (equivalent to
 * setting `notes` to ""). Responds with an empty body.
 */
export async function deleteFavoriteNote(profileId: number): Promise<void> {
	const path = `${NOTES_PATH}/${profileId}`;
	const res = await fetchRest(path, { method: "DELETE" });
	if (res.status >= 400) {
		throw new ApiHttpError(res.status, res.text(), path);
	}
}
