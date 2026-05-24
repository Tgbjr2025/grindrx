<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";

	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import * as Item from "$lib/components/ui/item";
	import DiscreetIconSetting from "./DiscreetIconSetting.svelte";
	import DistanceUnitSetting from "./DistanceUnitSetting.svelte";
	import IncognitoSetting from "./IncognitoSetting.svelte";
	import RevealMessageReadSetting from "./RevealMessageReadSetting.svelte";
	import RevealProfileViewSetting from "./RevealProfileViewSetting.svelte";

	type FeatureDialog = {
		title: string;
		description: string;
	};

	let openDialog = $state<FeatureDialog | null>(null);

	const features: Record<string, FeatureDialog> = {
		Notifications: {
			title: "Notifications",
			description:
				"Notification settings are not yet available in this version. Enable notifications from your device settings.",
		},
		PIN: {
			title: "PIN Lock",
			description:
				"PIN lock adds an extra layer of security. This feature is coming soon.",
		},
	};
</script>

<div class="flex w-full px-4">
	<main class="pb-18 flex flex-col gap-3 w-full max-w-120 m-auto">
		{#snippet item({ title }: { title: string })}
			<Item.Root variant="outline">
				{#snippet child({ props })}
					<button
						type="button"
						{...props}
						onclick={() => (openDialog = features[title] ?? null)}
					>
						<Item.Content class="max-xxxxs:min-w-0">
							<Item.Title class="min-w-0 max-w-full truncate inline-block">
								{title}
							</Item.Title>
						</Item.Content>
						<Item.Actions class="min-w-0">
							<CaretRightIcon class="size-4 shrink-0" />
						</Item.Actions>
					</button>
				{/snippet}
			</Item.Root>
		{/snippet}
		{@render item({ title: "Notifications" })}
		<h2>Display</h2>
		<DistanceUnitSetting />
		<h2>Privacy</h2>
		<IncognitoSetting />
		<RevealMessageReadSetting />
		<RevealProfileViewSetting />
		<h2>Security</h2>
		<DiscreetIconSetting />
		{@render item({ title: "PIN" })}
	</main>
</div>

<AlertDialog.Root
	open={openDialog !== null}
	onOpenChange={(v) => {
		if (!v) openDialog = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{openDialog?.title}</AlertDialog.Title>
			<AlertDialog.Description>{openDialog?.description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel size="lg" onclick={() => (openDialog = null)}>
				Got it
			</AlertDialog.Cancel>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style lang="postcss">
	@reference "$layout";

	h2 {
		@apply ps-4 mt-2 text-xl font-semibold tracking-tight truncate;
	}
</style>
