// Per-version highlights for the "What's new" card shown once after an update.
// Keep the newest version's entry in sync with CHANGES.md. Versions without an
// entry fall back to a generic message.

export const VERSION_HIGHLIGHTS: Record<string, string[]> = {
	"0.1.36": [
		"Fixed: a grey outline person was drawn on top of every photo in the grid. You can see the actual pictures again.",
	],
	"0.1.35": [
		"Fixed: the 'Download' button in the update banner did nothing on Android. So did every tappable link in a chat, and the map link.",
		"New: if your version has a known fault that locks you out, the app now blocks with a full-screen 'Update required' and a working download button, instead of failing quietly.",
		"Only stable releases can ever push you to an update — a draft or pre-release is ignored.",
		"The app will never lock you out because a server was briefly unreachable.",
	],
	"0.1.34": [
		"Security: if you set a PIN between v0.1.25 and v0.1.32, it works again. That update could never unlock, and this release fixes it.",
		"Security: signing out now clears your saved messages, viewed locations and photos from the device.",
		"Security: turning the app lock off, or changing your PIN, now asks for your current PIN first.",
		"Security: chat previews no longer appear on your lock screen while the app lock is on.",
		"Fixed: the weight filter could never find anyone. It was searching in the wrong unit.",
		"Fixed: photos stopped flickering and re-downloading every time you scrolled past them.",
		"Fixed: typing in Chinese, Japanese or Korean no longer sent messages by accident.",
		"Fixed: reporting a message or profile now actually works, and you are told if it fails.",
		"Fixed: the microphone no longer stays on if you leave the screen while it is asking for permission.",
		"Fixed: the app no longer forgets unread messages that arrived while it was closed.",
		"Fixed: three separate Android build files disagreed about the version number, which could stop an update installing.",
	],
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
		"New: Android app backups are switched off, so your precise location and app-lock data can't be extracted via Android backup or device transfer.",
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

// Lookup MUST go through Object.hasOwn, not a bare `VERSION_HIGHLIGHTS[v]`.
//
// `VERSION_HIGHLIGHTS` is a plain object literal, so it inherits from
// Object.prototype. `VERSION_HIGHLIGHTS["toString"]` (and "constructor",
// "valueOf", "__proto__", "hasOwnProperty", …) is therefore NOT undefined — it is
// the inherited function. The old
//
//     return VERSION_HIGHLIGHTS[version] ?? ["Bug fixes and improvements."];
//
// so `??` never fired for those keys and returned a FUNCTION. The only consumer
// does `{#each items as item (item)}` (WhatsNewDialog.svelte), which throws on a
// non-iterable — so a version string of "toString" would have crashed the What's
// New dialog rather than falling back to the generic message.
//
// Not reachable today: the argument comes from `getVersion()` inside the Tauri
// runtime, not from user input. That is exactly why it is worth making sound
// rather than leaving it to stay unreachable.
export function highlightsFor(version: string): string[] {
	if (Object.hasOwn(VERSION_HIGHLIGHTS, version)) {
		return VERSION_HIGHLIGHTS[version];
	}
	return ["Bug fixes and improvements."];
}
