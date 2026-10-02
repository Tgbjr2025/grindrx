<script lang="ts">
	import { CheckCircleIcon, SparkleIcon } from "phosphor-svelte";

	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import { highlightsFor } from "$lib/data/whats-new";

	let {
		open = $bindable(false),
		version,
		onTour,
	}: {
		open: boolean;
		version: string;
		onTour: () => void;
	} = $props();

	const items = $derived(highlightsFor(version));
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) open = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<div class="flex items-center gap-2">
				<SparkleIcon class="size-5 text-primary" weight="fill" />
				<AlertDialog.Title>What's new in {version}</AlertDialog.Title>
			</div>
		</AlertDialog.Header>

		<ul class="flex flex-col gap-2 py-1">
			{#each items as item (item)}
				<li class="flex gap-2 text-sm">
					<CheckCircleIcon class="size-4 shrink-0 mt-0.5 text-primary" weight="fill" />
					<span>{item}</span>
				</li>
			{/each}
		</ul>

		<AlertDialog.Footer>
			<Button
				variant="outline"
				class="cursor-pointer"
				onclick={() => {
					open = false;
					onTour();
				}}
			>
				Tour all features
			</Button>
			<Button class="cursor-pointer" onclick={() => (open = false)}>Got it</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
