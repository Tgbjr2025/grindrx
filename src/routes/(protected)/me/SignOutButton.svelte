<script lang="ts">
	import { CaretRightIcon, SignOutIcon } from "phosphor-svelte";
	import * as Item from "$lib/components/ui/item";
	import { Button } from "$lib/components/ui/button";
	import { callMethod } from "$lib/api";
	import ButtonItemContent from "./ButtonItemContent.svelte";

	async function onSignOut() {
		try {
			await callMethod("logout");
			window.location.href = "/auth/sign-in";
		} catch (error) {
			console.error(error);
			return null;
		}
	}
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<ButtonItemContent {...props} variant="outline" onclick={() => onSignOut()}>
			<Item.Media>
				<SignOutIcon weight="fill" class="size-5" />
			</Item.Media>
			<Item.Content class="min-w-0">
				<Item.Title class="truncate min-w-0 w-full inline-block text-left">
					Sign Out
				</Item.Title>
			</Item.Content>
			<Item.Actions>
				<CaretRightIcon class="size-4" />
			</Item.Actions>
		</ButtonItemContent>
	{/snippet}
</Item.Root>
