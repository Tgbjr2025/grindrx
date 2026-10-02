# FIX_NOTES — v0.1.29 (auto-fill favorite notes from chat)

**Date:** 2026-08-30 · **Base:** `aaf1bf5` (v0.1.28) · **Rollback tag:** `pre-v0.1.29` = `aaf1bf5`
**Branch:** `claude/grindrx-freeze-json-audit-gp4lnk` · **Operator:** Tom

Tom: "give it the option … to auto gen notes … the person's name if it is mentioned or their number
or address." Frontend-only feature. Verified: vitest 189 (was 177), svelte-check 0 errors, eslint
clean. Version 0.1.28→0.1.29, versionCode base 1065→1070.

## Auto-fill favorite notes
- **Extraction (pure, tested):** `src/lib/utils/note-extract.ts` — `extractNoteFields(texts)` returns
  `{ names[], phoneNumber, address }` via deterministic regex (NANP phone with [2-9] area/prefix guard;
  street-suffix address heuristic incl. optional city/ST/zip; name triggers "I'm/my name is/this
  is/call me/it's" capturing a Capitalized word or two, with a stopword filter). `buildNoteText`
  merges finds into existing note text without duplicating lines. No LLM, nothing leaves the device.
  Tests: `note-extract.test.ts` (12).
- **UI:** `FavoriteNotesDialog.svelte` gains an "Auto-fill from chat" button (`autoFill()`):
  - Gets our profileId via `getMyProfile()`, builds the conversationId the app uses
    (`[profileId, ourProfileId].toSorted().join(":")`), fetches messages via
    `getConversationMessages` ($lib/api/messages), and scans ONLY the other person's Text messages
    (`senderId === profileId`).
  - Fills the phone field only if empty; appends Name/Address lines to the note without overwriting.
    The user reviews and Saves. Toasts summarize what was found.
- No new endpoints, no Rust change.

## Note
Detection is heuristic (recent messages only, first page). It's a convenience that pre-fills for
review, not an authoritative extraction — false positives are harmless (user edits before saving).
