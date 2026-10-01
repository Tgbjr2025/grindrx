import z from "zod";

/**
 * What a safety report is filed against.
 *
 * `profile` — a profile, by profile id. See `reportProfile` in `$lib/api/report`.
 * `rightNowPost` — a right-now post, by post id. The server keys that resource on
 * the post, not the profile, so the two are NOT interchangeable.
 */
export const reportTargetSchema = z.enum(["profile", "rightNowPost"]);
export type ReportTarget = z.infer<typeof reportTargetSchema>;

/**
 * Why a report is being filed.
 *
 * ⚠️ **THE VOCABULARY HERE IS UNVERIFIED.** No live request has been made against
 * the server, because confirming these values would mean submitting a real abuse
 * report against a real account. The set below is the set the UI offers, chosen
 * to cover the categories a safety surface must be able to express. It is a
 * guess about the server's vocabulary, not a transcription of it.
 *
 * This is the ONE place to correct when the real values are known. Nothing else
 * hardcodes a reason string. If a submission comes back 4xx, the likeliest cause
 * is a wrong value HERE — not a bug in `reportProfile`.
 *
 * Deliberately a strict union, NOT `z.enum([...]).or(z.string())`: see the note
 * on `rightNowStatusSchema` in `./right-now` — the `.or(z.string())` widening
 * makes the enum branch dead code, validating nothing while implying it does.
 * That reasoning applies to parsing values the *server* chooses and we must
 * tolerate. It does NOT apply here, because this value is chosen by *us* in the
 * UI: a closed set is the whole point, and the cost of being wrong is a failed
 * report with a 4xx naming the offending field, not silent corruption.
 */
export const reportReasonSchema = z.enum([
	/** Undisclosed or misleading age. */
	"underage",
	/** Impersonation of a public figure or another person. */
	"impersonation",
	/** Harassment, threats, or abusive behaviour. */
	"harassment",
	/** Hate speech targeting a protected characteristic. */
	"hate",
	/** Sexual content the reporter did not consent to receive. */
	"sexual_content",
	/** Spam, advertising, or solicitation. */
	"spam",
	/** Scam, fraud, or a request for money. */
	"scam",
	/** Violent or self-harm content. */
	"violence",
	/** Sharing someone's private information. */
	"doxxing",
	/** A photo taken or shared without consent. */
	"non_consensual_photos",
	/** Anything the above does not cover. */
	"other",
]);
export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * User-facing copy for each reason. Kept beside the enum so adding a reason
 * forces adding its label — a missing entry here would render an empty button.
 */
export const reportReasonLabels: Record<ReportReason, string> = {
	underage: "Underage or fake age",
	impersonation: "Impersonation",
	harassment: "Harassment or threats",
	hate: "Hate speech",
	sexual_content: "Unwanted sexual content",
	spam: "Spam or advertising",
	scam: "Scam or fraud",
	violence: "Violence or self-harm",
	doxxing: "Sharing my private information",
	non_consensual_photos: "Non-consensual photos",
	other: "Something else",
};
