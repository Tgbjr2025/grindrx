// Semver comparison for the in-app update check.
//
// Versions come from two places with slightly different shapes: the running
// app reports a bare `0.1.25` (Tauri config version), while a release tag is
// usually `v0.1.25` and can carry a pre-release/build suffix (`v0.1.25-rc1`).
// We compare only the numeric MAJOR.MINOR.PATCH core, tolerating both.

export function parseSemver(v: string): [number, number, number] {
	const clean = v.trim().replace(/^v/i, "");
	// Drop any pre-release (`-rc1`) or build (`+abc`) suffix before splitting.
	const core = clean.split(/[-+]/, 1)[0] ?? "";
	const parts = core.split(".").map((p) => Number.parseInt(p, 10));
	return [
		Number.isFinite(parts[0]) ? parts[0] : 0,
		Number.isFinite(parts[1]) ? parts[1] : 0,
		Number.isFinite(parts[2]) ? parts[2] : 0,
	];
}

/** True when `latest` is a strictly higher version than `current`. */
export function isNewer(latest: string, current: string): boolean {
	const [lMaj, lMin, lPat] = parseSemver(latest);
	const [cMaj, cMin, cPat] = parseSemver(current);
	if (lMaj !== cMaj) return lMaj > cMaj;
	if (lMin !== cMin) return lMin > cMin;
	return lPat > cPat;
}
