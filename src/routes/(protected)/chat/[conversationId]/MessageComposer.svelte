<script lang="ts">
	import { ImagesIcon, MicrophoneIcon, PaperPlaneRightIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import { expoOut } from "svelte/easing";
	import { fade } from "svelte/transition";

	import { shareAlbum } from "$lib/api/album";
	import { sendProfilePhotoMessage } from "$lib/api/messages";
	import type { ProfilePhoto } from "$lib/api/profile";
	import ToastUnimplemented from "$lib/components/ToastUnimplemented.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Textarea } from "$lib/components/ui/textarea";
	import type { AlbumExpirationType } from "$lib/model/album";
	import type { Message } from "$lib/model/message";
	import AlbumPicker from "./AlbumPicker.svelte";

	let {
		onSend,
		recipientProfileId,
	}: {
		onSend: (params: Message) => void | Promise<void>;
		recipientProfileId: number | null;
	} = $props();

	let textContent = $state("");
	let albumPickerOpen = $state(false);

	async function onSubmit() {
		const text = textContent.trim();
		if (text === "") return;
		try {
			await onSend({ type: "Text", body: { text } });
			textContent = "";
		} catch (error) {
			console.error(error);
			toast.error("Failed to send message");
		}
	}

	async function onShareAlbum(albumId: number, expirationType: AlbumExpirationType) {
		if (recipientProfileId === null) {
			toast.error("Cannot share album — conversation not loaded");
			return;
		}
		await shareAlbum({ albumId, profileId: recipientProfileId, expirationType });
	}

	async function onSendPhoto(photo: ProfilePhoto & { mediaId: number }) {
		if (recipientProfileId === null) {
			toast.error("Cannot send photo — conversation not loaded");
			return;
		}
		await sendProfilePhotoMessage({
			toUserId: recipientProfileId,
			mediaId: photo.mediaId,
			mediaHash: photo.mediaHash,
			createdAt: photo.createdAt ?? null,
		});
	}
</script>

<div class="relative mx-2 mb-1 shrink-0 min-w-0 flex items-end gap-0 bg-card/80 backdrop-blur-sm rounded-[24px] border border-border/60 px-1 py-1 shadow-sm">
	<Button
		type="button"
		variant="ghost"
		size="icon"
		class="size-9.5 shrink-0 cursor-pointer p-2 mb-0 rounded-full"
		onclick={() => {
			if (recipientProfileId === null) return;
			albumPickerOpen = true;
		}}
	>
		<ImagesIcon
			weight="fill"
			color="var(--muted-foreground)"
			class="size-4.5"
		/>
	</Button>

	<form
		class="relative flex-1 min-h-9.5 min-w-0"
		onsubmit={(event) => {
			event.preventDefault();
			onSubmit().catch((error) => console.error(error));
		}}
	>
		<Textarea
			placeholder="Say something..."
			class="min-h-9.5 rounded-[20px] bg-transparent border-0 shadow-none focus-visible:ring-0 shrink-0 max-h-31.5 py-2 pr-9.5 h-fit! leading-5 placeholder-shown:truncate"
			onkeydown={(
				event: KeyboardEvent & {
					currentTarget: EventTarget & HTMLTextAreaElement;
				},
			) => {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					event.currentTarget.form?.requestSubmit();
				}
			}}
			bind:value={textContent}
		/>
		{#if textContent === ""}
			<div class="button" transition:fade={{ duration: 400, easing: expoOut }}>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-full cursor-pointer p-2"
					onclick={() => {
						toast(ToastUnimplemented, {
							componentProps: {
								feature: "Voice messages",
								issue: 35,
							},
						});
					}}
				>
					<MicrophoneIcon
						weight="fill"
						color="var(--muted-foreground)"
						class="size-4.5"
					/>
				</Button>
			</div>
		{:else}
			<div class="button" transition:fade={{ duration: 400, easing: expoOut }}>
				<Button
					type="submit"
					variant="ghost"
					size="icon"
					class="size-full cursor-pointer p-2"
				>
					<PaperPlaneRightIcon
						weight="fill"
						color="var(--primary)"
						class="size-4.5"
					/>
				</Button>
			</div>
		{/if}
	</form>
</div>

<AlbumPicker bind:open={albumPickerOpen} onShare={onShareAlbum} {onSendPhoto} />

<style lang="postcss">
	@reference "$layout";
	.button {
		@apply size-9.5 absolute bottom-0 right-0;
	}
</style>
