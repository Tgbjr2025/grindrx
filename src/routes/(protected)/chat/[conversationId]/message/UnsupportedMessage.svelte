<script lang="ts">
	import { getMessageMetaContext } from "./context";

	let { type }: { type: string } = $props();

	const { setRef } = $derived(getMessageMetaContext()());
	let el: HTMLDivElement | null = $state(null);
	$effect(() => {
		setRef(el ?? null);
	});

	// The remaining types genuinely carry no renderable payload (`body` is
	// `z.unknown()`/WIP in the API docs) — give the known ones an honest,
	// specific label instead of dumping the raw type name.
	const LABELS: Record<string, string> = {
		Generative: "AI-generated message",
		VideoCall: "Video call",
		ProfileLink: "Profile link",
		NonExpiringVideo: "Video",
		Unknown: "Unsupported message",
	};
</script>

<div
	class="bg-card text-muted-foreground/30 w-full rounded-lg p-2 max-w-full text-center text-sm"
	bind:this={el}
>
	{LABELS[type] ?? `Unsupported message type: ${type}`}
</div>
