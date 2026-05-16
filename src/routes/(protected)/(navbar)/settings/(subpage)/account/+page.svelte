<script lang="ts">
	import { CaretRightIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import ToastUnimplemented from "$lib/components/ToastUnimplemented.svelte";
	import * as Item from "$lib/components/ui/item";
</script>

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-3 w-full max-w-120 m-auto">
		{#snippet item({ title }: { title: string })}
			<Item.Root variant="outline">
				{#snippet child({ props })}
					<a
						href="#/"
						{...props}
						onclick={() =>
							toast(ToastUnimplemented, {
								componentProps: {
									feature: "Account settings",
									issue: 47,
								},
							})}
					>
						<Item.Content class="max-xxxxs:min-w-0">
							<Item.Title class="min-w-0 max-w-full truncate inline-block">
								{title}
							</Item.Title>
						</Item.Content>
						<Item.Actions class="min-w-0">
							<!-- <Item.Description class="min-w-0">{value}</Item.Description> -->
							<CaretRightIcon class="size-4 shrink-0" />
						</Item.Actions>
					</a>
				{/snippet}
			</Item.Root>
		{/snippet}
		{@render item({ title: "Email" })}
		{@render item({ title: "Password" })}
		{@render item({ title: "Blocked users" })}
		{@render item({ title: "Hidden users" })}
		{@render item({ title: "Delete account" })}
	</main>
</div>
