// Auto-note extraction: scan chat text for the kind of details you'd jot on a
// favorite — a name they gave, a phone number, or a street address. Deterministic
// and regex-based (no LLM, nothing leaves the device beyond the note you choose
// to save). It's a convenience that pre-fills the note field; the user reviews and
// edits before saving, so a stray match is harmless.

export type ExtractedNote = {
	names: string[];
	phoneNumber: string | null;
	address: string | null;
};

// Area code + prefix start at [2-9] (real NANP numbers never start a group with
// 0/1); optional +1 and common separators. Deliberately conservative.
const PHONE_RE =
	/(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})/;

const STREET_SUFFIX =
	"street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|circle|cir|terrace|ter|highway|hwy|parkway|pkwy|trail|trl|square|sq|court|drive";
const ADDRESS_RE = new RegExp(
	String.raw`\b\d{1,6}\s+(?:[A-Za-z0-9.'\-]+\s+){0,4}(?:${STREET_SUFFIX})\.?\b(?:[,\s]+[A-Za-z.\s]+)?(?:[,\s]+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?`,
	"i",
);

// "I'm Alex", "my name is Alex", "this is Alex", "call me Alex", "it's Alex".
// The trigger is case-insensitive (first letter as a class) but the captured name
// must be Capitalized, so we don't need the `i` flag (which would let the name
// group match lowercase words).
const NAME_RE =
	/\b(?:[Ii]['’]?m|[Ii] am|[Mm]y name(?:['’]?s| is)|[Tt]his is|[Cc]all me|[Ii]t['’]?s|[Nn]ame['’]?s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;

// Words that follow the name triggers but aren't names.
const NAME_STOPWORDS = new Set([
	"Not",
	"Just",
	"Here",
	"Good",
	"Fine",
	"Ok",
	"Okay",
	"Looking",
	"Down",
	"Free",
	"Busy",
	"Home",
	"So",
	"Really",
	"Actually",
	"Gonna",
	"About",
]);

export function normalizePhone(match: RegExpMatchArray): string {
	const [, area, prefix, line] = match;
	return `(${area}) ${prefix}-${line}`;
}

export function extractNoteFields(texts: string[]): ExtractedNote {
	const joined = texts.join("\n");

	const phoneMatch = joined.match(PHONE_RE);
	const phoneNumber = phoneMatch ? normalizePhone(phoneMatch) : null;

	const addressMatch = joined.match(ADDRESS_RE);
	const address = addressMatch ? addressMatch[0].replace(/\s+/g, " ").trim() : null;

	const names: string[] = [];
	for (const m of joined.matchAll(NAME_RE)) {
		const name = m[1].trim();
		const first = name.split(" ")[0];
		if (NAME_STOPWORDS.has(first)) continue;
		if (!names.includes(name)) names.push(name);
	}

	return { names, phoneNumber, address };
}

/**
 * Build a human-readable note body from extracted fields, merging into any
 * existing note text without duplicating lines already present.
 */
export function buildNoteText(existing: string, extracted: ExtractedNote): string {
	const lines: string[] = [];
	if (extracted.names.length > 0) lines.push(`Name: ${extracted.names.join(" / ")}`);
	if (extracted.address) lines.push(`Address: ${extracted.address}`);

	const base = existing.trim();
	const additions = lines.filter((l) => !base.includes(l));
	if (additions.length === 0) return base;
	return base ? `${base}\n${additions.join("\n")}` : additions.join("\n");
}
