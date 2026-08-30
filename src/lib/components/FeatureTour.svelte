<script lang="ts">
	import {
		BellIcon,
		ChatTextIcon,
		HandWavingIcon,
		ImagesIcon,
		LockKeyIcon,
		MagnifyingGlassIcon,
		MicrophoneIcon,
		NotePencilIcon,
		SparkleIcon,
	} from "phosphor-svelte";

	import { Button } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import { markTourDone } from "$lib/stores/onboarding.svelte";

	let { open = $bindable(false) }: { open: boolean } = $props();

	type Slide = { icon: typeof ChatTextIcon; title: string; body: string };
	const slides: Slide[] = [
		{
			icon: HandWavingIcon,
			title: "Welcome to GrindrX",
			body: "A privacy-focused Grindr client with extras you won't find in the regular app. Here's a 30-second tour — tap Next, or skip anytime.",
		},
		{
			icon: MagnifyingGlassIcon,
			title: "Getting around",
			body: "The bottom bar is Browse, Right Now, Interest, Search, and Inbox — your profile and all settings live behind your avatar on the right.",
		},
		{
			icon: ChatTextIcon,
			title: "Saved phrases",
			body: "Save phrases you send often and drop them into any chat with one tap — they even pop up as suggestions as you type.",
		},
		{
			icon: MicrophoneIcon,
			title: "Voice messages",
			body: "Tap the mic in a chat to record and send a voice message.",
		},
		{
			icon: ImagesIcon,
			title: "Albums, your way",
			body: "Share several albums at once. Create, rename, and manage your own albums — and who can see them — in Settings → Account → My Albums.",
		},
		{
			icon: NotePencilIcon,
			title: "Notes on favorites",
			body: "Keep a private note on any favorite (the Notes button on the Favorites screen). 'Auto-fill from chat' grabs a name, number, or address they mentioned.",
		},
		{
			icon: LockKeyIcon,
			title: "PIN lock",
			body: "Lock the app behind a PIN in Settings → App → Security.",
		},
		{
			icon: BellIcon,
			title: "Notification control",
			body: "Turn message and tap notifications on or off in Settings → App → Notifications.",
		},
		{
			icon: SparkleIcon,
			title: "And more",
			body: "Share GrindrX with a friend, check downloads & active-user stats, and get an in-app notice with a changelog whenever a new version is out. You can reopen this tour anytime from Settings.",
		},
	];

	let index = $state(0);
	const isLast = $derived(index === slides.length - 1);
	const slide = $derived(slides[index]);

	function finish() {
		markTourDone();
		open = false;
		index = 0;
	}

	function next() {
		if (isLast) finish();
		else index += 1;
	}
</script>

<Drawer.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) finish();
	}}
>
	<Drawer.Content>
		<div class="px-6 pt-2 pb-6 flex flex-col items-center text-center gap-4 max-w-100 mx-auto w-full">
			<div class="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
				<slide.icon class="size-8 text-primary" weight="fill" />
			</div>
			<h2 class="text-xl font-semibold">{slide.title}</h2>
			<p class="text-sm text-muted-foreground min-h-16">{slide.body}</p>

			<div class="flex items-center justify-center gap-1.5 py-1">
				{#each slides as s, i (s.title)}
					<span
						class={[
							"size-1.5 rounded-full transition-colors",
							i === index ? "bg-primary" : "bg-muted-foreground/30",
						]}
					></span>
				{/each}
			</div>

			<div class="flex w-full gap-2 pt-1">
				{#if index > 0}
					<Button variant="outline" class="flex-1 cursor-pointer" onclick={() => (index -= 1)}>
						Back
					</Button>
				{:else}
					<Button variant="ghost" class="flex-1 cursor-pointer text-muted-foreground" onclick={finish}>
						Skip
					</Button>
				{/if}
				<Button class="flex-1 cursor-pointer" onclick={next}>
					{isLast ? "Get started" : "Next"}
				</Button>
			</div>
		</div>
	</Drawer.Content>
</Drawer.Root>
