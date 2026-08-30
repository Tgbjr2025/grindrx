<script lang="ts">
	import { CaretRightIcon, ChartBarIcon } from "phosphor-svelte";

	import * as Item from "$lib/components/ui/item";
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<a href="/settings/stats" {...props}>
			<Item.Media>
				<ChartBarIcon weight="fill" class="size-5" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="truncate min-w-0 w-full inline-block text-left">
					Downloads & active users
				</Item.Title>
			</Item.Content>
			<Item.Actions>
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</a>
	{/snippet}
</Item.Root>
