export type TextSegment =
	| { type: "text"; value: string }
	| { type: "url"; value: string };

// Only linkify explicit http(s) URLs. Bare domains / www. are intentionally not
// matched to avoid turning ordinary text ("see you at 5.30") into bad links.
const URL_RE = /https?:\/\/[^\s<]+/gi;

// Trailing characters that are usually sentence punctuation, not part of a URL.
const TRAILING = /[.,!?;:'")\]}>]+$/;

/** Number of occurrences of `ch` in `s`. */
function countOf(s: string, ch: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
	return n;
}

/**
 * Split a message string into plain-text and URL segments so a template can
 * render URLs as clickable links while leaving the rest as (auto-escaped) text.
 * Never returns markup — the caller renders each segment through normal Svelte
 * templating, so this is XSS-safe by construction.
 */
export function linkifySegments(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	let last = 0;

	for (const match of text.matchAll(URL_RE)) {
		const start = match.index;
		const raw = match[0];
		let url = raw;
		let trailing = "";

		// Peel trailing punctuation, but keep the closing parens the URL itself
		// needs (Wikipedia URLs).
		//
		// The old test was `url.includes("(") && !url.slice(0, -1).includes(")")`,
		// which only worked when there was exactly ONE trailing paren. For a
		// balanced-but-trailing URL like
		// `https://en.wikipedia.org/wiki/Foo_(bar))` it failed, BOTH parens were
		// stripped, and the link became the broken `…/Foo_(bar`.
		//
		// The rule is now "pop exactly one `)` per UNBALANCED open paren in the part
		// of the URL before the trailing run": count opens minus closes there, and
		// move that many `)` characters out of the trailing run and into the URL.
		// A nested case (`…/Foo_(bar_(baz))`) needs two, and a run with no parens at
		// all is unaffected.
		const t = url.match(TRAILING);
		if (t) {
			trailing = t[0];
			const beforeRun = url.slice(0, url.length - trailing.length);
			const deficit = countOf(beforeRun, "(") - countOf(beforeRun, ")");
			const keep = Math.min(Math.max(deficit, 0), countOf(trailing, ")"));
			if (keep > 0) {
				let kept = 0;
				let rebuilt = "";
				for (const ch of trailing) {
					if (ch === ")" && kept < keep) {
						kept++;
						continue;
					}
					rebuilt += ch;
				}
				url = beforeRun + ")".repeat(keep);
				trailing = rebuilt;
			} else {
				url = beforeRun;
			}
		}

		// Validate it actually parses as http(s) before treating it as a link.
		// Assigned once so there is no dead initial write for the linter to flag.
		let valid: boolean;
		try {
			valid = ["http:", "https:"].includes(new URL(url).protocol);
		} catch {
			valid = false;
		}

		if (start > last) segments.push({ type: "text", value: text.slice(last, start) });
		if (valid && url.length > 0) {
			segments.push({ type: "url", value: url });
			if (trailing) segments.push({ type: "text", value: trailing });
		} else {
			segments.push({ type: "text", value: raw });
		}
		last = start + raw.length;
	}

	if (last < text.length) segments.push({ type: "text", value: text.slice(last) });
	// Collapse to a single text segment when there were no links at all.
	if (segments.length === 0) segments.push({ type: "text", value: text });
	return segments;
}
