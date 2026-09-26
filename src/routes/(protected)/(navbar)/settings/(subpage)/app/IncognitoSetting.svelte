<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { ApiHttpError } from "$lib/api";
	import {
		getPreferences,
		setPreferences,
	} from "$lib/app-data/preferences.svelte";
	import { getPrefsSettings, setPrefsSettings } from "$lib/api/prefs";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	// Real incognito, not just a badge.
	//
	// Previously this wrote ONLY the local `preferences.incognito` flag, which
	// drives the "Incognito" chip on the grid and nothing else — so the toggle
	// changed a label while the account stayed fully visible to other people.
	// That description said so out loud ("visual indicator only"), which was
	// honest but left the actual feature unimplemented.
	//
	// Grindr's real visibility controls are server-side prefs on
	// PUT /v3/me/prefs/settings (see $lib/api/prefs and
	// docs/content/grindr-api/settings/account.md):
	//   - `incognito`            — withhold the profile from browse results.
	//   - `locationSearchOptOut` — stop the profile appearing in location search.
	// Both are now written here, so the toggle actually hides the account.
	//
	// The local flag is kept in sync because the grid's "Incognito" chip reads
	// it, and because it is the honest fallback if the prefs call fails for a
	// reason OTHER than a paywall (offline, 5xx): the user still gets the
	// reminder badge rather than silently believing they are exposed.
	let value = $state<boolean | null>(null);
	let saving = $state(false);
	// True once we know the server rejected the write for entitlement reasons,
	// so the copy can tell the user why nothing happened.
	let gated = $state(false);

	onMount(() => {
		(async () => {
			// Server state is the source of truth. Fall back to the local flag
			// only if the prefs endpoint is unreachable at startup.
			const local = (await getPreferences()).incognito;
			try {
				const { incognito, locationSearchOptOut } = await getPrefsSettings();
				// Either flag on means "hidden", so light the toggle for both.
				value = Boolean(incognito || locationSearchOptOut);
			} catch (e) {
				console.error("Failed to load server incognito state", e);
				value = local;
			}
		})().catch((e) => {
			console.error("Failed to load preferences", e);
			value = false;
		});
	});

	async function apply(next: boolean, previous: boolean) {
		value = next;
		saving = true;
		try {
			await setPrefsSettings({
				incognito: next,
				locationSearchOptOut: next,
			});
			// Only claim incognito locally once the server has accepted it,
			// otherwise the grid badge would lie about the account's visibility.
			await setPreferences({ incognito: next });
			gated = false;
			if (next) {
				toast.success(
					"Incognito on — you're hidden from browse results and location search.",
				);
			}
		} catch (e) {
			// Revert the switch; the server is authoritative and still exposing
			// the account, so leaving the toggle on would be a lie.
			value = previous;
			if (e instanceof ApiHttpError && (e.status === 402 || e.status === 403)) {
				gated = true;
				toast.error("Incognito mode requires a Grindr XTRA subscription.");
			} else {
				console.error("Failed to set incognito", e);
				toast.error("Couldn't update incognito mode. Please try again.");
			}
		} finally {
			saving = false;
		}
	}
</script>

<SwitchField
	title="Incognito mode"
	description={gated
		? "Requires a Grindr XTRA subscription — your account is still visible."
		: "Hides your profile from browse results and location search. Grindr may gate this behind XTRA on your account."}
	disabled={value === null || saving}
	bind:checked={
		() => value ?? false,
		(v: boolean) => {
			const previous = value ?? false;
			if (v === previous) return;
			void apply(v, previous);
		}
	}
/>
