<script lang="ts">
	import { CameraIcon, ChatTextIcon, ImagesIcon, MicrophoneIcon, PaperPlaneRightIcon, TrashIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import { expoOut } from "svelte/easing";
	import { fade } from "svelte/transition";

	import { pickAudioMimeType, uploadAudioBlob } from "$lib/api/audio";
	import { uploadProfileImage } from "$lib/api/profile";
	import { Button } from "$lib/components/ui/button";
	import { Textarea } from "$lib/components/ui/textarea";
	import { getSavedPhrases } from "$lib/stores/saved-phrases.svelte";
	import type { AlbumExpirationType } from "$lib/model/album";
	import type { Message } from "$lib/model/message";
	import AlbumPicker from "./AlbumPicker.svelte";
	import SavedPhrasesDrawer from "./SavedPhrasesDrawer.svelte";

	let {
		onSend,
		onSendAlbum,
		onSendPhotoOptimistic,
		onSendAudio,
		recipientProfileId,
	}: {
		onSend: (params: Message) => void | Promise<void>;
		onSendAlbum: (albumIds: number[], expirationType: AlbumExpirationType) => Promise<void>;
		onSendPhotoOptimistic: (params: { mediaId: number; mediaHash: string; url?: string; createdAt: number | null }) => Promise<void>;
		onSendAudio: (params: { mediaId: number; mediaHash: string; url: string; contentType: string; length: number }) => Promise<void>;
		recipientProfileId: number | null;
	} = $props();

	let textContent = $state("");
	let albumPickerOpen = $state(false);
	let savedPhrasesOpen = $state(false);
	let uploading = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// --- Voice messages (record → upload → send) ---
	let recording = $state(false);
	let sendingAudio = $state(false);
	let recordSeconds = $state(0);
	let mediaRecorder: MediaRecorder | null = null;
	let audioStream: MediaStream | null = null;
	let audioChunks: Blob[] = [];
	let recordStartMs = 0;
	let recordTimer: ReturnType<typeof setInterval> | null = null;
	let cancelledRecording = false;

	function teardownRecording() {
		if (recordTimer) {
			clearInterval(recordTimer);
			recordTimer = null;
		}
		if (audioStream) {
			for (const track of audioStream.getTracks()) track.stop();
			audioStream = null;
		}
		mediaRecorder = null;
		recording = false;
	}

	async function startRecording() {
		if (recording || sendingAudio || recipientProfileId === null) return;
		if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			toast.error("Voice recording isn't available on this device.");
			return;
		}
		try {
			audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			toast.error("Microphone permission is needed to record a voice message.");
			return;
		}
		cancelledRecording = false;
		audioChunks = [];
		const mimeType = pickAudioMimeType();
		try {
			mediaRecorder = new MediaRecorder(audioStream, { mimeType });
		} catch {
			mediaRecorder = new MediaRecorder(audioStream);
		}
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) audioChunks.push(e.data);
		};
		mediaRecorder.onstop = () => {
			const lengthMs = Date.now() - recordStartMs;
			const type = mediaRecorder?.mimeType || mimeType;
			teardownRecording();
			if (cancelledRecording || audioChunks.length === 0) return;
			const blob = new Blob(audioChunks, { type });
			void uploadAndSendAudio(blob, lengthMs);
		};
		recordStartMs = Date.now();
		recordSeconds = 0;
		recording = true;
		recordTimer = setInterval(() => {
			recordSeconds = Math.floor((Date.now() - recordStartMs) / 1000);
			// Hard cap at 5 minutes.
			if (recordSeconds >= 300) stopRecording();
		}, 250);
		mediaRecorder.start();
	}

	function stopRecording() {
		if (!recording || !mediaRecorder) return;
		// onstop handles upload/send.
		mediaRecorder.stop();
	}

	function cancelRecording() {
		if (!recording) return;
		cancelledRecording = true;
		if (mediaRecorder) mediaRecorder.stop();
		else teardownRecording();
	}

	async function uploadAndSendAudio(blob: Blob, lengthMs: number) {
		// Too short to be intentional — drop it.
		if (lengthMs < 500) return;
		sendingAudio = true;
		try {
			const media = await uploadAudioBlob(blob, lengthMs);
			await onSendAudio(media);
		} catch (err) {
			console.error("Failed to send voice message", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to send voice message${detail}`);
		} finally {
			sendingAudio = false;
		}
	}

	function formatRecordTime(s: number): string {
		const m = Math.floor(s / 60);
		const sec = s % 60;
		return `${m}:${sec.toString().padStart(2, "0")}`;
	}

	function insertPhrase(text: string) {
		const current = textContent;
		if (current.trim() === "") {
			textContent = text;
		} else {
			// Append to whatever is typed, with a single separating space.
			textContent = current.replace(/\s+$/, "") + " " + text;
		}
	}

	// Live saved-phrase suggestions: as the user types, saved phrases that match
	// the current text surface above the composer for one-tap completion. An exact
	// match is excluded, so a just-picked phrase doesn't keep suggesting itself.
	const phraseSuggestions = $derived.by(() => {
		const q = textContent.trim().toLowerCase();
		if (q.length < 1) return [];
		return getSavedPhrases()
			.filter((p) => {
				const t = p.text.toLowerCase();
				return t.includes(q) && t !== q;
			})
			.sort((a, b) => {
				// Prefer phrases that START with the query.
				const as = a.text.toLowerCase().startsWith(q) ? 0 : 1;
				const bs = b.text.toLowerCase().startsWith(q) ? 0 : 1;
				return as - bs;
			})
			.slice(0, 4);
	});

	function applySuggestion(text: string) {
		textContent = text;
	}

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

	async function onShareAlbum(albumIds: number[], expirationType: AlbumExpirationType) {
		await onSendAlbum(albumIds, expirationType);
	}

	async function onSendPhoto(params: {
		mediaId: number;
		mediaHash: string;
		url: string;
		createdAt: number | null;
	}) {
		await onSendPhotoOptimistic(params);
	}

	async function onFileSelected(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file || recipientProfileId === null) return;
		input.value = "";

		uploading = true;
		try {
			const { mediaHash, mediaId, url } = await uploadProfileImage(file);
			await onSendPhotoOptimistic({
				mediaId,
				mediaHash,
				url,
				createdAt: Date.now(),
			});
		} catch (err) {
			console.error("Failed to upload and send photo", err);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to send photo${detail}`);
		} finally {
			uploading = false;
		}
	}
</script>

{#if phraseSuggestions.length > 0}
	<div class="mx-2 mb-1 flex flex-col gap-1 shrink-0" transition:fade={{ duration: 120 }}>
		{#each phraseSuggestions as phrase (phrase.id)}
			<button
				type="button"
				class="text-left text-sm px-3 py-2 rounded-xl bg-card/90 backdrop-blur-sm border border-border/60 shadow-sm hover:bg-accent active:bg-accent/70 transition-colors cursor-pointer"
				onclick={() => applySuggestion(phrase.text)}
			>
				<span class="line-clamp-1 break-words">{phrase.text}</span>
			</button>
		{/each}
	</div>
{/if}

<div class="relative mx-2 mb-1 shrink-0 min-w-0 flex items-end gap-0 bg-card/80 backdrop-blur-sm rounded-[24px] border border-border/60 px-1 py-1 shadow-sm">
	{#if recording}
		<div class="absolute inset-0 z-10 flex items-center gap-3 bg-card rounded-[24px] px-3" transition:fade={{ duration: 120 }}>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-9.5 shrink-0 cursor-pointer rounded-full"
				aria-label="Cancel recording"
				onclick={cancelRecording}
			>
				<TrashIcon color="var(--destructive)" class="size-4.5" />
			</Button>
			<span class="size-2.5 rounded-full bg-red-500 animate-pulse shrink-0"></span>
			<span class="flex-1 text-sm tabular-nums text-muted-foreground">
				Recording… {formatRecordTime(recordSeconds)}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-9.5 shrink-0 cursor-pointer rounded-full"
				aria-label="Send voice message"
				onclick={stopRecording}
			>
				<PaperPlaneRightIcon weight="fill" color="var(--primary)" class="size-4.5" />
			</Button>
		</div>
	{/if}
	<!-- Albums / My Photos picker -->
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

	<!-- Saved phrases / quick replies -->
	<Button
		type="button"
		variant="ghost"
		size="icon"
		class="size-9.5 shrink-0 cursor-pointer p-2 mb-0 rounded-full"
		aria-label="Saved phrases"
		onclick={() => (savedPhrasesOpen = true)}
	>
		<ChatTextIcon
			weight="fill"
			color="var(--muted-foreground)"
			class="size-4.5"
		/>
	</Button>

	<!-- Camera / device gallery upload -->
	<label
		class="size-9.5 shrink-0 flex items-center justify-center rounded-full cursor-pointer p-2 transition-colors hover:bg-accent"
		class:opacity-50={uploading}
	>
		{#if uploading}
			<span class="size-4.5 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin"></span>
		{:else}
			<CameraIcon weight="fill" color="var(--muted-foreground)" class="size-4.5" />
		{/if}
		<input
			bind:this={fileInputEl}
			type="file"
			accept="image/*"
			class="sr-only"
			disabled={uploading || recipientProfileId === null}
			onchange={onFileSelected}
		/>
	</label>

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
					aria-label="Record voice message"
					disabled={sendingAudio || recipientProfileId === null}
					onclick={() => void startRecording()}
				>
					{#if sendingAudio}
						<span class="size-4.5 border-2 border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin"></span>
					{:else}
						<MicrophoneIcon
							weight="fill"
							color="var(--muted-foreground)"
							class="size-4.5"
						/>
					{/if}
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

<SavedPhrasesDrawer bind:open={savedPhrasesOpen} onInsert={insertPhrase} />

<style lang="postcss">
	@reference "$layout";
	.button {
		@apply size-9.5 absolute bottom-0 right-0;
	}
</style>
