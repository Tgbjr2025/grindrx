import { differenceInCalendarDays, format, startOfDay } from "date-fns";

/**
 * Label for a day separator in the message list.
 *
 * The previous inline version was:
 *
 *   isToday(dayStart) ? "Today"
 *     : startOfToday().getTime() - dayStart < 7 * 24 * 60 * 60 * 1000
 *       ? format(dayStart, "EEEE")
 *       : format(dayStart, "E, LLL d")
 *
 * which had two defects:
 *
 * 1. **No lower bound.** `startOfToday() - dayStart` goes NEGATIVE for a
 *    future-dated `dayStart` (server/client clock skew, a device clock change,
 *    a timezone mismatch), and a negative number is `< 7 days`, so a future day
 *    rendered as a bare weekday name with no date — reading as "today" or
 *    "recent" when it is neither.
 * 2. **Not DST-safe.** `7 * 24 * 60 * 60 * 1000` is exactly 168 hours. Across a
 *    DST transition the hours between two local midnights is 167 or 169, so a
 *    message from 6 days back could fall outside the window and render as
 *    "E, LLL d" instead of the weekday.
 *
 * `differenceInCalendarDays` compares local calendar days, so it is immune to
 * both, and a negative result (future) correctly falls through to the dated
 * branch.
 *
 * NOTE: `startOfDay`, not `startOfToday`. In date-fns v4 `startOfToday()` takes
 * no date argument — passing one is silently ignored and it always returns the
 * real current day, which would make the `now` parameter a no-op.
 */
export function dayGroupLabel(
	dayStart: number,
	now: number = Date.now(),
): string {
	const days = differenceInCalendarDays(startOfDay(now), dayStart);
	if (days === 0) return "Today";
	if (days > 0 && days < 7) return format(dayStart, "EEEE");
	return format(dayStart, "E, LLL d");
}
