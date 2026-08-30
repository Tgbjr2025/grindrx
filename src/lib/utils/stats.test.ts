import { describe, expect, it } from "vitest";

import { aggregateDownloads, parseActiveUsers } from "$lib/utils/stats";

describe("aggregateDownloads", () => {
	const raw = {
		github: [
			{ tag_name: "v0.1.25", assets: [{ download_count: 10 }] },
			{ tag_name: "v0.1.24", assets: [{ download_count: 5 }, { download_count: 2 }] },
		],
		forgejo: [
			{ tag_name: "v0.1.25", assets: [{ download_count: 3 }] },
			{ tag_name: "v0.1.23", assets: [{ download_count: 100 }] },
		],
	};

	it("sums per repo and the grand total", () => {
		const s = aggregateDownloads(raw);
		expect(s.github.total).toBe(17); // 10 + (5+2)
		expect(s.forgejo.total).toBe(103); // 3 + 100
		expect(s.total).toBe(120);
	});

	it("combines per-version across repos, highest first", () => {
		const s = aggregateDownloads(raw);
		// v0.1.23 = 100, v0.1.25 = 10 + 3 = 13, v0.1.24 = 7
		expect(s.combined[0]).toEqual({ tag: "v0.1.23", count: 100 });
		expect(s.combined.find((v) => v.tag === "v0.1.25")?.count).toBe(13);
		expect(s.combined.find((v) => v.tag === "v0.1.24")?.count).toBe(7);
	});

	it("treats a null/missing repo as zero without crashing", () => {
		const s = aggregateDownloads({ github: null, forgejo: undefined });
		expect(s.total).toBe(0);
		expect(s.github.perVersion).toEqual([]);
	});

	it("handles releases with no assets", () => {
		const s = aggregateDownloads({ github: [{ tag_name: "v1" }], forgejo: [] });
		expect(s.total).toBe(0);
		expect(s.github.perVersion).toEqual([{ tag: "v1", count: 0 }]);
	});

	it("tolerates completely malformed input", () => {
		expect(aggregateDownloads("nope").total).toBe(0);
		expect(aggregateDownloads(null).total).toBe(0);
	});
});

describe("parseActiveUsers", () => {
	it("reads the aggregator's shape and sorts versions by count", () => {
		const a = parseActiveUsers({
			active_1h: 2,
			active_24h: 9,
			active_7d: 40,
			versions_24h: { "0.1.24": 3, "0.1.25": 6 },
			total_known: 50,
		});
		expect(a.active1h).toBe(2);
		expect(a.active24h).toBe(9);
		expect(a.active7d).toBe(40);
		expect(a.byVersion).toEqual([
			{ version: "0.1.25", count: 6 },
			{ version: "0.1.24", count: 3 },
		]);
	});

	it("defaults everything to zero for empty/garbage input", () => {
		const a = parseActiveUsers(null);
		expect(a).toEqual({ active1h: 0, active24h: 0, active7d: 0, byVersion: [] });
	});
});
