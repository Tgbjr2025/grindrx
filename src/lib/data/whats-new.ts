// Per-version highlights for the "What's new" card shown once after an update.
// Keep the newest version's entry in sync with CHANGES.md. Versions without an
// entry fall back to a generic message.

export const VERSION_HIGHLIGHTS: Record<string, string[]> = {
	"0.1.33": [
		"Fixed: the keyboard no longer covers the message box — you can read messages and actually reply.",
		"Fixed: voice messages never played. They now load, with a loading and failure state instead of a dead play button.",
		"Fixed: reading older messages no longer jumps to the bottom. A 'N new messages' pill appears instead.",
		"Fixed: reactions are now removable, and you can react to your own messages.",
		"Fixed: rotating the screen no longer throws away your scroll position and unsent messages.",
		"Fixed: every photo, album and voice message showed 'Preview not available' in your chats.",
		"Fixed: album photos can be added and removed again. Only the cover used to be visible.",
		"Fixed: profile edits saving silently, a black screen when going back from a profile, and incognito not actually working.",
		"New: sending a location in chat, not just receiving one.",
		"New: screenshot protection — the app is blocked from screen recording and from the recent-apps thumbnail.",
		"New: Android app backups are switched off, so your precise location and app-lock data can't be extracted.",
	],
	"0.1.32": [
		"App lock with fingerprint or face — you can now unlock with just a biometric, no PIN needed.",
	],
	"0.1.31": ["Fingerprint and face unlock on top of the PIN app lock."],
	"0.1.30": [
		"Fixed: favoriting a profile now works (it silently failed before).",
		"New: a first-run tour and this What's-New card so you can find every feature.",
	],
	"0.1.29": [
		"Auto-fill a favorite's note from your chat — pulls a name, number, or address they mentioned.",
	],
	"0.1.28": [
		"Voice messages — record and send audio in chat.",
		"Search profiles by tag from the new Search tab.",
		"Manage your albums: create, rename, delete, add photos, manage viewers.",
		"Private notes on favorites.",
	],
	"0.1.27": [
		"Fixed Blocked / Hidden / Favorites lists that failed to load.",
		"Notification settings (message & tap toggles).",
		"Saved-phrase autocomplete as you type.",
	],
	"0.1.26": [
		"Share GrindrX with a friend, and a Downloads & active-users stats screen.",
	],
	"0.1.25": [
		"Saved phrases, share multiple albums at once, PIN app-lock, and in-app update notices.",
	],
};

export function highlightsFor(version: string): string[] {
	return VERSION_HIGHLIGHTS[version] ?? ["Bug fixes and improvements."];
}
