<script lang="ts">
	import { ChatTextIcon, PlusIcon, TrashIcon } from "phosphor-svelte";

	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { Textarea } from "$lib/components/ui/textarea";
	import {
		addSavedPhrase,
		getSavedPhrases,
		removeSavedPhrase,
	} from "$lib/stores/saved-phrases.svelte";

	let {
		open = $bindable(false),
		onInsert,
	}: {
		open: boolean;
		/** Called with the chosen phrase text; the composer decides how to apply it. */
		onInsert: (text: string) => void;
	} = $props();

	let newPhrase = $state("");

	const phrases = $derived(getSavedPhrases());

	function choose(text: string) {
		onInsert(text);
		open = false;
	}

	function addNew() {
		const created = addSavedPhrase(newPhrase);
		if (created) newPhrase = "";
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content>
		<Drawer.Header>
			<Drawer.Title>Saved phrases</Drawer.Title>
		</Drawer.Header>

		<div class="px-4 pb-4 flex flex-col gap-3">
			{#if phrases.length === 0}
				<div class="flex flex-col items-center gap-2 py-6 text-muted-foreground">
					<ChatTextIcon class="size-10" weight="duotone" />
					<p class="text-sm text-center">
						No saved phrases yet. Add one below to reuse it in any chat.
					</p>
				</div>
			{:else}
				<p class="text-xs text-muted-foreground">
					Tap a phrase to drop it into the message box.
				</p>
				<div class="flex flex-col gap-2 max-h-64 overflow-y-auto">
					{#each phrases as phrase (phrase.id)}
						<div
							class="flex items-center gap-2 rounded-xl border border-border overflow-hidden"
						>
							<button
								type="button"
								class="flex-1 min-w-0 text-left px-3 py-2.5 text-sm cursor-pointer hover:bg-accent active:bg-accent/70 transition-colors"
								onclick={() => choose(phrase.text)}
							>
								<span class="line-clamp-2 break-words">{phrase.text}</span>
							</button>
							<button
								type="button"
								aria-label="Delete phrase"
								class="shrink-0 p-2 mr-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:bg-destructive/20 transition-colors cursor-pointer"
								onclick={() => removeSavedPhrase(phrase.id)}
							>
								<TrashIcon class="size-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex items-end gap-2 pt-1">
				<Textarea
					bind:value={newPhrase}
					placeholder="Add a new phrase…"
					class="min-h-10 max-h-28 flex-1 rounded-xl text-sm"
					onkeydown={(
						event: KeyboardEvent & {
							currentTarget: EventTarget & HTMLTextAreaElement;
						},
					) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							addNew();
						}
					}}
				/>
				<Button
					type="button"
					size="icon"
					class="size-10 shrink-0 rounded-xl cursor-pointer"
					disabled={newPhrase.trim() === ""}
					onclick={addNew}
				>
					<PlusIcon class="size-4.5" weight="bold" />
				</Button>
			</div>
		</div>
	</Drawer.Content>
</Drawer.Root>
