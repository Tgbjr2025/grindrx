<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
	import DiscreetIconSetting from "./DiscreetIconSetting.svelte";
	import DistanceUnitSetting from "./DistanceUnitSetting.svelte";
	import IncognitoSetting from "./IncognitoSetting.svelte";
	import PinLockSetting from "./PinLockSetting.svelte";
	import RevealMessageReadSetting from "./RevealMessageReadSetting.svelte";
	import RevealProfileViewSetting from "./RevealProfileViewSetting.svelte";
</script>

<div class="flex w-full px-4">
	<main class="pb-18 flex flex-col gap-3 w-full max-w-120 m-auto">
		<Item.Root variant="outline">
			{#snippet child({ props })}
				<a href="/settings/app/notifications" {...props}>
					<Item.Content class="max-xxxxs:min-w-0">
						<Item.Title class="min-w-0 max-w-full truncate inline-block">
							Notifications
						</Item.Title>
					</Item.Content>
					<Item.Actions class="min-w-0">
						<CaretRightIcon class="size-4 shrink-0" />
					</Item.Actions>
				</a>
			{/snippet}
		</Item.Root>
		<h2>Display</h2>
		<DistanceUnitSetting />
		<h2>Privacy</h2>
		<IncognitoSetting />
		<RevealMessageReadSetting />
		<RevealProfileViewSetting />
		<h2>Security</h2>
		<DiscreetIconSetting />
		<PinLockSetting />
	</main>
</div>

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply ps-4 mt-2 text-xl font-semibold tracking-tight truncate;
	}
</style>
