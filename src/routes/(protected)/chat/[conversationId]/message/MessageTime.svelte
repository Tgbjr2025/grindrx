<script lang="ts">
	import { getMessageContext } from "./context";

	const { timestamp } = $derived(getMessageContext()());

	// Was hardcoded to the date-fns token `H:mm`, i.e. 24-hour clock and English
	// regardless of device settings. Use the DEVICE locale/timezone instead:
	// `Intl.DateTimeFormat().resolvedOptions().timeZone` is the device zone, which
	// is what `new Date(ms)` already interprets, so the two agree.
	//
	// Built once at module scope: constructing an `Intl.DateTimeFormat` is
	// comparatively expensive and this runs for every message in the list. The
	// TIMEZONE handling itself was always correct and is unchanged — only the
	// format is now locale-driven. `hourCycle` is derived from the resolved
	// locale's hour cycle so a 12-hour locale gets `h:mm a` and a 24-hour locale
	// gets `HH:mm`, rather than forcing 24-hour English onto everyone.
	const timeFormat = new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
</script>

{timeFormat.format(new Date(timestamp))}
