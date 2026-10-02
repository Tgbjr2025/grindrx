<script lang="ts">
	import { SparkleIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import {
		deleteFavoriteNote,
		getFavoriteNote,
		setFavoriteNote,
	} from "$lib/api/favorites-notes";
	import { getConversationMessages } from "$lib/api/messages";
	import { getMyProfile } from "$lib/api/profile";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import { Textarea } from "$lib/components/ui/textarea";
	import { buildNoteText, extractNoteFields } from "$lib/utils/note-extract";

	let {
		open = $bindable(false),
		profileId,
		profileName,
	}: {
		open: boolean;
		profileId: number;
		profileName: string | null;
	} = $props();

	let notes = $state("");
	let phoneNumber = $state("");
	let loading = $state(false);
	let saving = $state(false);
	let clearing = $state(false);
	let scanning = $state(false);
	let loadError = $state<string | null>(null);

	// The profile whose note is currently loaded, so opening the dialog for a
	// different favorite refetches instead of showing the previous one's note.
	let loadedFor = $state<number | null>(null);

	$effect(() => {
		if (open && loadedFor !== profileId) {
			void load();
		}
		if (!open) {
			loadedFor = null;
		}
	});

	async function load() {
		loading = true;
		loadError = null;
		notes = "";
		phoneNumber = "";
		try {
			const note = await getFavoriteNote(profileId);
			notes = note.notes;
			phoneNumber = note.phoneNumber;
			loadedFor = profileId;
		} catch (err) {
			console.error("Failed to load favorite note", err);
			loadError = "Failed to load note.";
		} finally {
			loading = false;
		}
	}

	async function save() {
		saving = true;
		try {
			await setFavoriteNote(profileId, { notes, phoneNumber });
			open = false;
			toast.success("Note saved");
		} catch (err) {
			console.error("Failed to save favorite note", err);
			toast.error("Failed to save note. Please try again.");
		} finally {
			saving = false;
		}
	}

	// Scan the conversation with this favorite and pre-fill the note with any
	// name / phone / address they mentioned. Only reads THEIR messages (info they
	// gave you), never overwrites what's already typed — appends and fills blanks,
	// leaving you to review before saving.
	async function autoFill() {
		scanning = true;
		try {
			const me = await getMyProfile();
			const conversationId = [profileId, me.profileId]
				.toSorted((a, b) => a - b)
				.join(":");
			const { messages } = await getConversationMessages({ conversationId });
			const texts: string[] = [];
			for (const m of messages) {
				if (m.senderId === profileId && m.type === "Text") texts.push(m.body.text);
			}
			if (texts.length === 0) {
				toast("No messages from them to scan yet.");
				return;
			}
			const extracted = extractNoteFields(texts);
			let filled = 0;
			if (extracted.phoneNumber && phoneNumber.trim() === "") {
				phoneNumber = extracted.phoneNumber;
				filled++;
			}
			const merged = buildNoteText(notes, extracted);
			if (merged !== notes) {
				notes = merged;
				filled++;
			}
			if (filled === 0) toast("Nothing new found in this chat.");
			else toast.success("Filled in what I found — review, then Save.");
		} catch (err) {
			console.error("Auto-fill failed", err);
			toast.error("Couldn't scan the chat.");
		} finally {
			scanning = false;
		}
	}

	async function clearNote() {
		clearing = true;
		try {
			await deleteFavoriteNote(profileId);
			notes = "";
			phoneNumber = "";
			open = false;
			toast.success("Note cleared");
		} catch (err) {
			console.error("Failed to clear favorite note", err);
			toast.error("Failed to clear note. Please try again.");
		} finally {
			clearing = false;
		}
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) open = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>
				Note for {profileName ?? "Anonymous"}
			</AlertDialog.Title>
			<AlertDialog.Description>
				A private note and phone number, visible only to you.
			</AlertDialog.Description>
		</AlertDialog.Header>

		<form
			class="flex flex-col gap-3 py-1"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			<Textarea
				aria-label="Note"
				placeholder="Add a note…"
				rows={4}
				disabled={loading || saving || clearing || scanning}
				bind:value={notes}
			/>
			<input
				type="tel"
				inputmode="tel"
				autocomplete="off"
				aria-label="Phone number"
				placeholder="Phone number (optional)"
				disabled={loading || saving || clearing || scanning}
				bind:value={phoneNumber}
				class="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-base outline-none focus:border-primary md:text-sm"
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="gap-1.5 cursor-pointer self-start"
				disabled={loading || saving || clearing || scanning}
				onclick={autoFill}
			>
				<SparkleIcon class={["size-4", scanning && "animate-pulse"]} weight="fill" />
				{scanning ? "Scanning chat…" : "Auto-fill from chat"}
			</Button>
			{#if loadError}
				<p class="text-sm text-destructive">{loadError}</p>
			{/if}
		</form>

		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (open = false)}>Cancel</AlertDialog.Cancel>
			<Button
				variant="ghost"
				class="cursor-pointer text-destructive"
				disabled={loading || saving || clearing || scanning}
				onclick={clearNote}
			>
				{clearing ? "Clearing…" : "Clear note"}
			</Button>
			<Button
				class="cursor-pointer"
				disabled={loading || saving || clearing || scanning}
				onclick={save}
			>
				{saving ? "Saving…" : "Save"}
			</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
