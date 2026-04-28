<script lang="ts">
	import { expoOut } from "svelte/easing";
	import { fade } from "svelte/transition";

	let focused:
		| {
				startX: number;
				startY: number;
		  }
		| false = $state(false);
	const id = $props.id();

	function onclick(event: MouseEvent) {
		focused = !focused;
		if (focused) {
			document.documentElement.classList.add(`scroll-lock-${id}`);
		} else {
			document.documentElement.classList.remove(`scroll-lock-${id}`);
		}
		event.clientX;
	}
</script>

<button {onclick} class="item">
	<img
		src="https://placehold.co/600x400"
		alt=""
		draggable="false"
		class="w-full h-full aspect-[inherit] absolute top-0 left-0 object-cover"
	/>
</button>
{#if focused}
	<button
		class="bg-black/50 fixed top-0 left-0 size-full z-99"
		transition:fade={{ duration: 500, easing: expoOut }}
		onclick={() => (focused = false)}
		aria-label="Close image"
	></button>
	<div
		class="fixed top-0 left-0 size-full z-100 flex justify-center items-center p-4"
	>
		<img
			src="https://placehold.co/600x400"
			alt=""
			draggable="false"
			class="z-100 w-full h-full object-contain"
		/>
	</div>
{/if}

<style lang="postcss">
	@reference "$layout";
	.item {
		@apply w-full h-full aspect-[inherit] relative block;
		scroll-snap-stop: always;
	}
</style>
