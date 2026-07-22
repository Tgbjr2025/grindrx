export type TextSegment =
	| { type: "text"; value: string }
	| { type: "url"; value: string };

// Only linkify explicit http(s) URLs. Bare domains / www. are intentionally not
// matched to avoid turning ordinary text ("see you at 5.30") into bad links.
const URL_RE = /https?:\/\/[^\s<]+/gi;

// Trailing characters that are usually sentence punctuation, not part of a URL.
const TRAILING = /[.,!?;:'")\]}>]+$/;

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

		// Peel trailing punctuation, but keep a closing paren if the URL itself
		// contains a matching open paren (e.g. Wikipedia URLs).
		const t = url.match(TRAILING);
		if (t) {
			trailing = t[0];
			if (trailing.endsWith(")") && url.includes("(") && !url.slice(0, -1).includes(")")) {
				trailing = trailing.slice(0, -1);
			}
			url = url.slice(0, url.length - trailing.length);
		}

		// Validate it actually parses as http(s) before treating it as a link.
		let valid = false;
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
