// Aggregation for the download/active-user stats screen.
//
// `fetch_download_stats` (Rust) returns `{ github: <releases[]|null>, forgejo:
// <releases[]|null> }`, where each release is `{ tag_name, name, assets:
// [{ download_count }] }` (GitHub and Forgejo/Gitea share these field names).
// We sum `download_count` per version, per repo, and combined across repos.

type ReleaseAsset = { download_count?: number };
type Release = { tag_name?: string; name?: string; assets?: ReleaseAsset[] };

export type VersionCount = { tag: string; count: number };
export type RepoDownloads = { total: number; perVersion: VersionCount[] };

export type DownloadStats = {
	/** Downloads across every version and both repos. */
	total: number;
	github: RepoDownloads;
	forgejo: RepoDownloads;
	/** Per-version counts summed across both repos, highest first. */
	combined: VersionCount[];
};

function sumRepo(releases: unknown): RepoDownloads {
	if (!Array.isArray(releases)) return { total: 0, perVersion: [] };
	const perVersion: VersionCount[] = [];
	let total = 0;
	for (const r of releases as Release[]) {
		const tag = r?.tag_name ?? r?.name ?? "?";
		const count = Array.isArray(r?.assets)
			? r.assets.reduce((s, a) => s + (a?.download_count ?? 0), 0)
			: 0;
		perVersion.push({ tag, count });
		total += count;
	}
	return { total, perVersion };
}

export function aggregateDownloads(raw: unknown): DownloadStats {
	const obj =
		raw && typeof raw === "object"
			? (raw as { github?: unknown; forgejo?: unknown })
			: {};
	const github = sumRepo(obj.github);
	const forgejo = sumRepo(obj.forgejo);

	// Combine per-version across both repos.
	const byTag = new Map<string, number>();
	for (const { tag, count } of [...github.perVersion, ...forgejo.perVersion]) {
		byTag.set(tag, (byTag.get(tag) ?? 0) + count);
	}
	const combined = [...byTag.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count);

	return { total: github.total + forgejo.total, github, forgejo, combined };
}

export type ActiveUsers = {
	active1h: number;
	active24h: number;
	active7d: number;
	/** Active installs in the last 24h, by app version. */
	byVersion: { version: string; count: number }[];
};

export function parseActiveUsers(raw: unknown): ActiveUsers {
	const o =
		raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	const versionsObj =
		o.versions_24h && typeof o.versions_24h === "object"
			? (o.versions_24h as Record<string, unknown>)
			: {};
	const byVersion = Object.entries(versionsObj)
		.map(([version, count]) => ({ version, count: num(count) }))
		.sort((a, b) => b.count - a.count);
	return {
		active1h: num(o.active_1h),
		active24h: num(o.active_24h),
		active7d: num(o.active_7d),
		byVersion,
	};
}
