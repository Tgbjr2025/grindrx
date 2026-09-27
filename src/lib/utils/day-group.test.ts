// The DST regression is only observable in a timezone that observes DST, and
// this host runs UTC. Node re-reads TZ for local-time Date operations, and
// date-fns reads the zone at call time (not import time), so stubbing TZ here
// makes the arithmetic real rather than a claim we cannot check on this
// machine. `vi.stubEnv` is used rather than `process.env.TZ` because this
// project does not include @types/node in the SvelteKit tsconfig.
import { addDays, setHours, setMinutes, startOfDay } from "date-fns";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { dayGroupLabel } from "$lib/utils/day-group";

beforeAll(() => {
	vi.stubEnv("TZ", "America/New_York");
});

afterAll(() => {
	vi.unstubAllEnvs();
});

/** Local midnight `n` days before `now`, as a timestamp. */
function daysAgo(now: Date, n: number): number {
	return startOfDay(addDays(now, -n)).getTime();
}

const NOW = new Date(2026, 8, 26, 15, 30); // Sat 26 Sep 2026, local time

describe("dayGroupLabel", () => {
	it("labels the current day 'Today'", () => {
		expect(dayGroupLabel(daysAgo(NOW, 0), NOW.getTime())).toBe("Today");
	});

	// "Yesterday" used to render as a bare weekday name (a message from yesterday
	// morning read "Friday", indistinguishable from five days ago).
	it("labels the immediately preceding day 'Yesterday'", () => {
		expect(dayGroupLabel(daysAgo(NOW, 1), NOW.getTime())).toBe("Yesterday");
		// ...at both ends of the day, not just near midnight.
		expect(
			dayGroupLabel(
				daysAgo(NOW, 1),
				setMinutes(setHours(NOW, 23), 59).getTime(),
			),
		).toBe("Yesterday");
		expect(
			dayGroupLabel(daysAgo(NOW, 1), setMinutes(setHours(NOW, 0), 5).getTime()),
		).toBe("Yesterday");
	});

	it("uses the weekday name for the two to six preceding days", () => {
		// 26 Sep 2026 is a Saturday, so day-2 is Thursday and day-6 is Sunday.
		expect(dayGroupLabel(daysAgo(NOW, 2), NOW.getTime())).toBe("Thursday");
		expect(dayGroupLabel(daysAgo(NOW, 3), NOW.getTime())).toBe("Wednesday");
		expect(dayGroupLabel(daysAgo(NOW, 6), NOW.getTime())).toBe("Sunday");
	});

	it("includes the date once the day is a week or more old", () => {
		expect(dayGroupLabel(daysAgo(NOW, 7), NOW.getTime())).toBe("Sat, Sep 19");
		expect(dayGroupLabel(daysAgo(NOW, 400), NOW.getTime())).toBe("Fri, Aug 22");
	});

	// The regression: `startOfToday().getTime() - dayStart` is negative for a
	// future day, and negative < 7 days, so the old code rendered a bare weekday
	// name for a date that had not happened yet — reading as "today" or "recent".
	it("does not render a future day as a bare weekday name", () => {
		const tomorrow = daysAgo(NOW, -1);
		expect(dayGroupLabel(tomorrow, NOW.getTime())).toBe("Sun, Sep 27");

		const farFuture = daysAgo(NOW, -400);
		expect(dayGroupLabel(farFuture, NOW.getTime())).toBe("Sun, Oct 31");
	});

	// The other regression: the old check was a fixed 168-hour window, which is
	// the wrong width whenever the intervening days include a DST change. US DST
	// ends 1 Nov 2026, so 27 Oct -> 2 Nov is 6 calendar days but only 157 hours.
	it("keeps a 6-day-old day on the weekday branch across a DST transition", () => {
		const afterDst = new Date(2026, 10, 2, 12, 0); // Mon 2 Nov 2026, EST
		const sixDaysBack = startOfDay(addDays(afterDst, -6)); // Tue 27 Oct, EDT

		// 157 hours — under the old fixed 168-hour window, so the old code would
		// ALSO have said "Tuesday" here. The failure is the other direction:
		expect((afterDst.getTime() - sixDaysBack.getTime()) / 3_600_000).toBe(157);

		// 7 calendar days back spans the 25-hour night, so it is 181 hours — OVER
		// 168. The old code put a 7-day-old day on the weekday branch; calendar-day
		// counting correctly moves it to the dated branch.
		const sevenDaysBack = startOfDay(addDays(afterDst, -7)); // Mon 26 Oct, EDT
		expect((afterDst.getTime() - sevenDaysBack.getTime()) / 3_600_000).toBe(
			181,
		);
		expect(dayGroupLabel(sevenDaysBack.getTime(), afterDst.getTime())).toBe(
			"Mon, Oct 26",
		);

		// And the 6-day case stays a weekday, which the old 168-hour window got
		// right by luck but the calendar-day count gets right by construction.
		expect(dayGroupLabel(sixDaysBack.getTime(), afterDst.getTime())).toBe(
			"Tuesday",
		);
	});

	it("does not depend on the time of day within the same day", () => {
		const earlyMorning = setMinutes(setHours(NOW, 0), 5);
		const lateNight = setMinutes(setHours(NOW, 23), 59);
		for (const now of [earlyMorning, lateNight]) {
			expect(dayGroupLabel(daysAgo(now, 0), now.getTime())).toBe("Today");
			expect(dayGroupLabel(daysAgo(now, 3), now.getTime())).toBe("Wednesday");
		}
	});
});
