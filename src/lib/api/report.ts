import z from "zod";

import { fetchRest } from "$lib/api";
import { throwForStatus } from "$lib/api/http";
import {
	type ReportReason,
	reportReasonSchema,
	type ReportTarget,
} from "$lib/model/report";

// Grindr report endpoints (grindr-api/safety):
//
//   GET  /v5/flags/{profileId}   -> prior report state for a profile
//   POST /v5/flags/{profileId}   -> report a profile
//   GET  /v1/flags/right-now/{postId}  -> prior report state for a right-now post
//   POST /v1/flags/right-now/{postId}  -> report a right-now post
//
// ⚠️ UNVERIFIED — READ BEFORE TRUSTING.
//
// There is at least one older generation of this endpoint in the wild
// (`/v3.1/flags/{id}` and `/v4/flags/{id}`), and which one the server honours
// depends on the deployment. **Nothing here has been probed against the live
// server**, because doing so requires a real authenticated session and a real
// report submission — which would mean filing a false abuse report against a
// real account. That is not an acceptable way to find out.
//
// So: the version is a single constant, chosen as the highest generation, and
// every failure logs the exact path used (`logRealPath`). If reporting turns out
// to be a silent no-op in the field, `REPORT_VERSION` is the ONLY thing to
// change, and the logged path proves which one was attempted.
//
// DO NOT "fix" a 4xx by widening the reason vocabulary — see `ReportReason`.
//
// ERROR REPORTING: same discipline as `block.ts`. `ApiHttpError.message`
// interpolates the path it is given, so the id-bearing path must never be passed
// to `throwForStatus` — otherwise the profile id of the person being reported
// lands in a user-facing toast. The real path goes to `logRealPath` instead.

/**
 * Which generation of the flags endpoint to use. `v5` is the highest observed.
 *
 * Change this alone to move between generations; nothing else hardcodes a version.
 */
const REPORT_VERSION = "v5" as const;

const PROFILE_FLAGS_PATH = `/${REPORT_VERSION}/flags`;
const RIGHT_NOW_FLAGS_PATH = "/v1/flags/right-now";

/**
 * The server's response to a report POST is not known to be stable across
 * generations, and a report that succeeds but returns an unexpected body must NOT
 * be reported to the user as a failure. So the response is accepted if it is
 * empty, or any JSON at all — only a non-2xx is treated as an error, which is
 * `throwForStatus`'s job.
 */
const reportAckSchema = z.unknown();

// Body is msgpack-encoded by `fetchRest` and re-serialised as JSON by the Rust
// bridge, so it MUST be a plain object — see the note on `sendTapWithType` in
// `taps.ts`. A pre-stringified body would go on the wire as a JSON string and
// the fields would never be parsed.
function reportBody(input: {
	reason: ReportReason;
	target: ReportTarget;
	comment?: string;
}): Record<string, unknown> {
	return {
		reason: input.reason,
		// `target` is the upstream field name for what is being reported. Kept
		// verbatim rather than renamed, so a server-side rename is visible in a
		// diff instead of silently breaking.
		target: input.target,
		...(input.comment === undefined ? {} : { comment: input.comment }),
	};
}

function logRealPath(action: string, path: string, status: number): void {
	console.error(`[GrindrX] Failed to ${action} (HTTP ${status}).`, path);
}

/**
 * File a safety report against a profile.
 *
 * Throws `ApiHttpError` on a non-2xx. The thrown message deliberately contains
 * only `PROFILE_FLAGS_PATH`, never the profile id.
 */
export async function reportProfile({
	profileId,
	reason,
	comment,
}: {
	profileId: number;
	reason: ReportReason;
	comment?: string;
}): Promise<void> {
	const path = `${PROFILE_FLAGS_PATH}/${profileId}`;
	const response = await fetchRest(path, {
		method: "POST",
		body: reportBody({ reason, target: "profile", comment }),
	});
	if (response.status >= 400) logRealPath("report profile", path, response.status);
	throwForStatus(response, PROFILE_FLAGS_PATH);
	// `jsonParsed` is SYNCHRONOUS in this layer (it calls `JSON.parse` then
	// `parseApiResponse`), so it returns a value rather than a promise — hence
	// try/catch, not `.catch()`.
	try {
		response.jsonParsed(reportAckSchema);
	} catch {
		// A report the server accepted must never be surfaced as a failure just
		// because the acknowledgement body was not what we expected.
	}
}

/**
 * File a safety report against a right-now post.
 *
 * `postId` is the right-now post's id, NOT a profile id — the server keys this
 * resource on the post. Passing a profile id here will 4xx.
 */
export async function reportRightNowPost({
	postId,
	reason,
	comment,
}: {
	postId: string;
	reason: ReportReason;
	comment?: string;
}): Promise<void> {
	const path = `${RIGHT_NOW_FLAGS_PATH}/${postId}`;
	const response = await fetchRest(path, {
		method: "POST",
		body: reportBody({ reason, target: "rightNowPost", comment }),
	});
	if (response.status >= 400)
		logRealPath("report right-now post", path, response.status);
	throwForStatus(response, RIGHT_NOW_FLAGS_PATH);
	// `jsonParsed` is SYNCHRONOUS in this layer, so it raises here rather than
	// rejecting later — `try`/`catch`, never `.catch()`. Same rationale as
	// `reportProfile` above.
	try {
		response.jsonParsed(reportAckSchema);
	} catch {
		// A report the server accepted must never be shown as failed.
	}
}

/**
 * Read back the current report state for a profile.
 *
 * Used to avoid filing a duplicate report for the same profile, and to let the UI
 * show "reported". The response shape is NOT known — it is parsed as a loose
 * record and normalised, so an unrecognised body yields `null` rather than
 * throwing. Callers must treat `null` as "unknown", never as "not reported".
 */
export async function getProfileReportState(
	profileId: number,
): Promise<ProfileReportState | null> {
	const path = `${PROFILE_FLAGS_PATH}/${profileId}`;
	const response = await fetchRest(path, { method: "GET" });
	if (response.status >= 400) logRealPath("read profile report", path, response.status);
	throwForStatus(response, PROFILE_FLAGS_PATH);
	// `jsonParsed` is SYNCHRONOUS in this layer, so it raises here rather than
	// rejecting later — `try`/`catch`, never `.catch()` (which is itself a
	// `TypeError` and would replace the real parse failure with a confusing one).
	//
	// An unreadable body is NOT an error here: a 2xx with an empty body is a
	// legitimate server answer, and `normaliseReportState` maps "no recognisable
	// body" to `null` — the documented "unknown", which callers must not read as
	// "not reported".
	let raw: unknown;
	try {
		raw = response.jsonParsed(z.unknown());
	} catch {
		raw = undefined;
	}
	return normaliseReportState(raw);
}

export interface ProfileReportState {
	/** Whether the server says this profile is already reported. */
	reported: boolean;
	/** Whatever else the server returned, for future callers. */
	raw: unknown;
}

function normaliseReportState(raw: unknown): ProfileReportState | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	// Deliberately lenient: accept any of the plausible field names rather than
	// requiring one, because the shape is unverified and a wrong guess must not
	// make the UI claim "not reported" when it simply did not recognise the body.
	const flag = [record.reported, record.isReported, record.flagged, record.flag].find(
		(v) => typeof v === "boolean",
	);
	return { reported: flag === true, raw };
}

/** Re-exported so callers can validate a reason before building a request. */
export { reportReasonSchema };
