<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { ApiHttpError } from "$lib/api";
	import { getPrefsSettings, setPrefsSettings } from "$lib/api/prefs";
	import SwitchField from "$lib/components/ui/switch-field/SwitchField.svelte";

	// `null` while the real server-side state is loading — SwitchField stays
	// disabled so a toggle can't fire before we know what to revert to.
	let value = $state<boolean | null>(null);
	let saving = $state(false);

	onMount(() => {
		(async () => {
			const { hideViewedMe } = await getPrefsSettings();
			// hideViewedMe is optional in the schema (server-field drift guard) —
			// default missing to `true` (hidden) so an unrecognised response can't
			// silently flip this privacy control to "revealed".
			value = !(hideViewedMe ?? true);
		})().catch((e) => {
			console.error("Failed to load prefs settings", e);
			value = false;
		});
	});
</script>

<SwitchField
	title="Reveal profile views"
	description="When off (default), Grindr keeps your profile views private. Turn on to let people see you've viewed their profile."
	disabled={value === null || saving}
	bind:checked={
		() => value ?? false,
		(v: boolean) => {
			const previous = value;
			value = v;
			saving = true;
			setPrefsSettings({ hideViewedMe: !v })
				.catch((e) => {
					value = previous;
					if (e instanceof ApiHttpError && (e.status === 402 || e.status === 403)) {
						toast.error(
							"Revealing profile views requires a Grindr XTRA subscription.",
						);
					} else {
						console.error("Failed to save prefs settings", e);
						toast.error("Failed to update profile view setting. Please try again.");
					}
				})
				.finally(() => {
					saving = false;
				});
		}
	}
/>
