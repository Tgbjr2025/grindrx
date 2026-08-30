// Per-version highlights for the "What's new" card shown once after an update.
// Keep the newest version's entry in sync with CHANGES.md. Versions without an
// entry fall back to a generic message.

export const VERSION_HIGHLIGHTS: Record<string, string[]> = {
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
	"0.1.26": ["Share GrindrX with a friend, and a Downloads & active-users stats screen."],
	"0.1.25": [
		"Saved phrases, share multiple albums at once, PIN app-lock, and in-app update notices.",
	],
};

export function highlightsFor(version: string): string[] {
	return VERSION_HIGHLIGHTS[version] ?? ["Bug fixes and improvements."];
}
