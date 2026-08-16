<script lang="ts">
	import AuthedImage from "$lib/components/AuthedImage.svelte";
	import type { GaymojiMessage } from "$lib/model/message";
	import { MessageMediaState } from "./message-media.svelte";

	let { message }: { message: GaymojiMessage["body"] } = $props();

	const media = new MessageMediaState();

	// The gaymoji catalog (`GET /grindr/chat/gaymoji`) exposes each entry as
	// `{ name, id }` where `id` is `name + ".png"`, served at
	// `/grindr/chat/gaymoji/{id}`. Message bodies only carry `imageHash`; treat
	// it as that catalog id and only append the extension if it's missing one.
	const gaymojiUrl = $derived(
		`https://cdns.grindr.com/grindr/chat/gaymoji/${
			message.imageHash.includes(".") ? message.imageHash : `${message.imageHash}.png`
		}`,
	);
</script>

<div class={["relative", { "ms-3": !media.clone }]} bind:this={media.el}>
	<AuthedImage src={gaymojiUrl} alt="Gaymoji" class="size-28 object-contain" draggable="false" />
	{@render media.adornments?.()}
</div>
