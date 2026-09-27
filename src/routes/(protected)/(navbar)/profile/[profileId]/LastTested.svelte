<script lang="ts">
	import { format } from "date-fns";
	import { ClockIcon } from "phosphor-svelte";

	import ProfileField from "./ProfileField.svelte";
	import ProfileValueLabel from "./ProfileValueLabel.svelte";

	let {
		lastTestedDate,
	}: {
		lastTestedDate: number | null | undefined;
	} = $props();

	/**
	 * Render a timestamp's UTC calendar month/year without the local timezone
	 * shifting it into the previous month.
	 *
	 * D21: `format(new Date(ts), "LLLL yyyy")` converts into the viewer's local
	 * zone first, so a month-boundary timestamp rendered as the PREVIOUS month for
	 * every negative-offset user (the entire Americas) — e.g. a 1 January test
	 * recorded at 00:30 UTC read "December 2024".
	 *
	 * The fix is to reinterpret the UTC calendar fields as local ones and pin the
	 * time to midday, so no DST shift (which is at most ~2 h) can move the date.
	 * This is a display-only adjustment; nothing is written back.
	 */
	function monthYearOf(ts: number): Date {
		const d = new Date(ts);
		return new Date(
			d.getUTCFullYear(),
			d.getUTCMonth(),
			d.getUTCDate(),
			12,
			0,
			0,
			0,
		);
	}
</script>

{#if lastTestedDate != null}
	<ProfileField>
		<ClockIcon class="shrink-0" />
		<ProfileValueLabel label="Last Tested">
			{format(monthYearOf(lastTestedDate), "LLLL yyyy")}
		</ProfileValueLabel>
	</ProfileField>
{/if}
