<script lang="ts">
	import {
		ArrowLeftIcon,
		ArrowRightIcon,
		ImageIcon,
		PlusIcon,
		StarIcon,
		TrashIcon,
	} from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import {
		clearAllProfileCaches,
		getProfileUploadedPhotos,
		MAX_SECONDARY_PROFILE_PHOTOS,
		setProfilePhotos,
		uploadProfilePhoto,
	} from "$lib/api/profile";
	import CdnImage from "$lib/components/CdnImage.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";
	import {
		loadFailed,
		loadStarted,
		loadSucceeded,
		orphanedUploadDropped,
		photoAdded,
		photoDeleted,
		photoMadePrimary,
		photoMoved,
		photosStateInit,
		planWrite,
		rollbackApplies,
		writeRefusalMessage,
	} from "$lib/profile-photos/photos-state";
	import type { PhotosState } from "$lib/profile-photos/photos-state";

	/**
	 * All of the decision logic lives in `$lib/profile-photos/photos-state` as
	 * pure functions, with 28 tests. This file is only the shell: the API calls,
	 * the serialised write chain, and the markup. That split is deliberate — the
	 * previous version of this screen had no tests at all, and two critical bugs
	 * lived in exactly the logic that is now covered.
	 */
	let model = $state<PhotosState>(photosStateInit());

	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	/** hash of the tile whose action sheet is open */
	let activeSheet = $state<string | null>(null);
	/** hash awaiting delete confirmation */
	let pendingDelete = $state<string | null>(null);
	/** per-hash in-flight flag, so a tile can show its own spinner */
	let busy = $state<Set<string>>(new Set());

	const photos = $derived(model.photos);
	const secondary = $derived(model.secondary);
	const primaryHash = $derived(model.primaryHash);
	let saving = $state(false);

	// --- Serialised mutations -------------------------------------------------
	// Every network mutation goes through ONE chain, including the DELETE. The
	// previous version issued the DELETE outside the chain, so it could land
	// after the PUT that still referenced the deleted hash and silently undo the
	// write — or before it, and leave the server recomputing an order against a
	// photo it no longer has.
	let writeChain: Promise<unknown> = Promise.resolve();
	function enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = writeChain.then(task, task);
		// Keep the chain alive after a rejection so one failure does not wedge
		// every later mutation.
		writeChain = run.catch(() => undefined);
		return run;
	}

	/**
	 * Persist the current ordering, or report honestly why it was not written.
	 *
	 * Returns `true` only when the server actually accepted the write. Callers
	 * MUST NOT report success otherwise — that is how the old screen came to
	 * toast "Photo added." for a photo it had never sent and had then pruned
	 * from its own list.
	 */
	async function persist(): Promise<boolean> {
		const plan = planWrite(model);
		if (!plan.ok) {
			toast.error(writeRefusalMessage(plan.reason));
			return false;
		}
		saving = true;
		try {
			await enqueue(() =>
				setProfilePhotos({
					primaryImageHash: plan.primaryImageHash,
					secondaryImageHashes: plan.secondaryImageHashes,
				}),
			);
			// The nav avatar and the settings row read `medias[0]` from a 60 s
			// cache; without this they keep showing the old photo until restart.
			clearAllProfileCaches();
			return true;
		} finally {
			saving = false;
		}
	}

	async function load() {
		model = loadStarted(model);
		try {
			const res = await getProfileUploadedPhotos();
			model = loadSucceeded(model, res.medias);
		} catch (err) {
			console.error("Failed to load profile photos", err);
			// NOTE: the previous set is deliberately left in place and `load`
			// becomes "error", which makes `planWrite` refuse. A failed read must
			// never be followed by a full-replacement PUT.
			model = loadFailed(model);
		}
	}

	void load();

	function setBusy(hash: string, on: boolean) {
		const next = new Set(busy);
		if (on) next.add(hash);
		else next.delete(hash);
		busy = next;
	}

	async function handleFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset so choosing the same file again re-fires `change`.
		input.value = "";
		if (!file) return;

		// Never upload against a set we failed to read: the PUT that follows is
		// full-replacement, so we would be deleting every photo we did not send.
		if (model.load !== "loaded") {
			toast.error("Couldn't load your current photos. Try again in a moment.");
			return;
		}

		uploading = true;
		let uploaded: string | null = null;
		try {
			const hash = await uploadProfilePhoto(file);
			uploaded = hash;
			const { state: next, outcome } = photoAdded(model, hash);
			if (outcome.kind === "rejected-full") {
				// The bytes reached the CDN but the profile is full. Say so, and
				// remove the upload rather than leaving it unreferenced forever.
				toast.error(
					`You can show ${outcome.maxSecondary + 1} photos. Remove one first.`,
				);
				await enqueue(() => deleteRemote(hash));
				model = orphanedUploadDropped(model, hash);
				return;
			}
			// Snapshot-and-restore is safe BECAUSE of the revision guard: if the
			// revision is still the one our own transition produced, no newer
			// mutation has landed and `before` is exactly the right thing to
			// restore. The old code restored an array snapshot unconditionally,
			// which silently discarded a concurrent "make main photo".
			const before = model;
			model = next;

			const wrote = await persist();
			if (!wrote) {
				// Nothing was sent, so the optimistic local change is a lie too.
				if (rollbackApplies(model, next.revision)) model = before;
				await load();
				return;
			}
			// Re-read so the server's response to OUR write is what the user sees
			// (it may normalise the order, and it is the source of truth).
			await load();
			toast.success("Photo added.");
		} catch (err) {
			console.error("Failed to add photo", err);
			if (uploaded !== null) model = photoDeleted(model, uploaded);
			const detail = err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to add photo${detail}`, { duration: 15000 });
		} finally {
			uploading = false;
		}
	}

	/** The documented delete: JSON *body*, and it purges the media from the CDN. */
	async function deleteRemote(hash: string): Promise<void> {
		const res = await fetchRest("/v3/me/profile/images", {
			method: "DELETE",
			body: { media_hashes: [hash] },
		});
		if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
		clearAllProfileCaches();
	}

	/**
	 * Apply an optimistic transition, persist it, and roll back ONLY if the
	 * transition is still the newest thing that happened.
	 *
	 * One helper for all four mutators, because the three hand-written versions
	 * this replaced each had a different (wrong) idea of what to restore.
	 */
	async function mutate(
		apply: (s: PhotosState) => PhotosState,
		commit: () => Promise<boolean>,
		failMessage: string,
		successMessage?: string,
	) {
		const before = model;
		const after = apply(before);
		// The pure transitions return the SAME object when nothing changed (a
		// tap on a disabled arrow), so identity is the "no-op" signal.
		if (after === before) return;
		model = after;
		const undo = () => {
			if (rollbackApplies(model, after.revision)) model = before;
		};
		try {
			if (!(await commit())) {
				// Refused or failed: never report success.
				undo();
				return;
			}
			await load();
			if (successMessage) toast.success(successMessage);
		} catch (err) {
			undo();
			console.error(failMessage, err);
			toast.error(failMessage);
		}
	}

	function makePrimary(hash: string) {
		if (primaryHash === hash) return;
		return mutate(
			(s) => photoMadePrimary(s, hash),
			persist,
			"Couldn't update your main photo.",
			"Main photo updated.",
		);
	}

	function move(hash: string, direction: -1 | 1) {
		return mutate(
			(s) => photoMoved(s, hash, direction),
			persist,
			"Couldn't reorder photos.",
		);
	}

	async function deletePhoto(hash: string) {
		setBusy(hash, true);
		activeSheet = null;
		try {
			await mutate(
				(s) => photoDeleted(s, hash),
				async () => {
					await enqueue(() => deleteRemote(hash));
					// Keep the remaining ordering in sync. `persist` refuses if the
					// set was never read, which is correct: we must not replace what
					// we cannot see. The delete itself already happened, so this
					// returning false is not a failure of the delete.
					await persist();
					return true;
				},
				"Failed to delete photo.",
				"Photo deleted.",
			);
		} finally {
			setBusy(hash, false);
		}
	}

	async function confirmDelete() {
		const hash = pendingDelete;
		pendingDelete = null;
		if (hash) await deletePhoto(hash);
	}

</script>

<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	class="hidden"
	onchange={(e) => void handleFileChosen(e)}
/>

<!-- Backdrop to close the action sheet -->
{#if activeSheet !== null && pendingDelete === null}
	<button
		type="button"
		aria-label="Close"
		class="fixed inset-0 z-40"
		onclick={() => (activeSheet = null)}
	></button>
{/if}

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-2">
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="text-sm text-muted-foreground">
					Add photos, choose the one people see first, and reorder the rest.
				</p>
			</div>
			<Button
				size="sm"
				class="shrink-0"
				disabled={uploading || saving || model.load === "loading"}
				onclick={() => fileInput?.click()}
			>
				{#if uploading}
					<Spinner class="size-4" />
				{:else}
					<PlusIcon class="size-4" />
				{/if}
				Add photo
			</Button>
		</div>

		{#if model.load === "loading" && photos.length === 0}
			<div class="flex flex-1 min-h-40 items-center justify-center">
				<Spinner class="size-6" />
			</div>
		{:else if model.load === "error" && photos.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<ImageIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>Couldn't load your photos</Empty.Title>
					<Empty.Description>
						Nothing has been changed. Retry when you have a connection — we
						won't overwrite your profile with photos we can't see.
					</Empty.Description>
				</Empty.Header>
				<Button variant="outline" size="sm" onclick={() => void load()}>
					Retry
				</Button>
			</Empty.Root>
		{:else if primaryHash === null && photos.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<ImageIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No photos</Empty.Title>
					<Empty.Description>
						Tap "Add photo" to upload your first picture.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			{#if model.load === "error"}
				<p class="text-xs text-destructive px-1" role="alert">
					Couldn't refresh your photos, so changes aren't being saved right now.
					<button type="button" class="underline" onclick={() => void load()}>
						Retry
					</button>
				</p>
			{/if}

			{#if primaryHash !== null}
				<p class="text-xs text-muted-foreground px-1">
					Your main photo — this is what other people see in the grid.
				</p>
				<div class="relative aspect-square w-full max-w-64 m-auto">
					<CdnImage
						hash={primaryHash}
						alt="Shown first in the grid"
						class="rounded-2xl"
					/>
					<span
						class="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white"
					>
						<StarIcon weight="fill" class="size-3" />
						Main
					</span>
					<!--
						The main photo previously had NO affordance at all, which made
						`deletePhoto`'s primary branch unreachable and left a one-photo
						profile as a dead end. It is a button now, for the same reason
						every other tile is.
					-->
					<button
						type="button"
						aria-label="Main photo options"
						aria-haspopup="menu"
						aria-expanded={activeSheet === primaryHash}
						class="absolute bottom-2 right-2 size-8 rounded-full bg-black/60 flex items-center justify-center"
						onclick={() =>
							(activeSheet = activeSheet === primaryHash ? null : primaryHash)}
					>
						<span class="text-white text-lg leading-none" aria-hidden="true">⋯</span>
					</button>
					{#if busy.has(primaryHash)}
						<div class="absolute inset-0 flex items-center justify-center">
							<Spinner class="size-6 text-white" />
						</div>
					{/if}
				</div>
			{/if}

			{#if secondary.length > 0}
				<p class="text-xs text-muted-foreground px-1">
					{secondary.length} of {MAX_SECONDARY_PROFILE_PHOTOS} extra photos shown.
					Use the arrows to reorder.
				</p>
			{/if}

			<div class="grid grid-cols-3 gap-1.5">
				{#each secondary as hash, i (hash)}
					{@const isBusy = busy.has(hash)}
					{@const isActive = activeSheet === hash}
					<div class="relative aspect-square">
						<button
							type="button"
							class="w-full h-full rounded-xl overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring"
							disabled={isBusy}
							aria-haspopup="menu"
							aria-expanded={isActive}
							aria-label="Photo {i + 2} options"
							onclick={() => (activeSheet = isActive ? null : hash)}
						>
							<CdnImage hash={hash} alt="Profile photo {i + 2}" imgClass="transition-opacity {isBusy ? 'opacity-40' : ''}" />
							{#if isBusy}
								<div class="absolute inset-0 flex items-center justify-center">
									<Spinner class="size-5 text-white" />
								</div>
							{/if}
						</button>

						{#if !isBusy}
							<div class="absolute top-1 left-1 right-1 flex items-center justify-between">
								<button
									type="button"
									aria-label="Move photo {i + 2} earlier"
									disabled={i === 0 || saving}
									class="size-6 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-30"
									onclick={() => void move(hash, -1)}
								>
									<ArrowLeftIcon weight="bold" class="size-3 text-white" />
								</button>
								<button
									type="button"
									aria-label="Move photo {i + 2} later"
									disabled={i === secondary.length - 1 || saving}
									class="size-6 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-30"
									onclick={() => void move(hash, 1)}
								>
									<ArrowRightIcon weight="bold" class="size-3 text-white" />
								</button>
							</div>
						{/if}

						{#if isActive && !isBusy}
							<div
								role="menu"
								aria-label="Photo actions"
								class="absolute bottom-1.5 left-1 right-1 z-50 flex flex-col gap-1 rounded-xl overflow-hidden shadow-xl border border-border bg-popover text-[13px]"
							>
								{#if hash !== primaryHash}
									<button
										type="button"
										role="menuitem"
										class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium"
										onclick={() => {
											activeSheet = null;
											void makePrimary(hash);
										}}
									>
										<StarIcon weight="fill" class="size-3.5 shrink-0" />
										Make main photo
									</button>
								{/if}
								<button
									type="button"
									role="menuitem"
									class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium text-destructive"
									onclick={() => {
										// Close the sheet as well, or dismissing the dialog
										// brings the sheet straight back.
										activeSheet = null;
										pendingDelete = hash;
									}}
								>
									<TrashIcon weight="fill" class="size-3.5 shrink-0" />
									Delete
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</main>
</div>

<!--
	Deleting purges the media from Grindr's CDN, so it gets a real confirmation.
	This is the repo's `alert-dialog` primitive (bits-ui) rather than a hand-rolled
	div: the old hand-rolled one declared `aria-modal="true"` with no focus trap,
	no Escape, no focus move and no `aria-describedby`, so every one of those
	declarations was a lie. The albums screen already used this primitive
	correctly.
-->
<AlertDialog.Root
	open={pendingDelete !== null}
	onOpenChange={(open) => {
		if (!open) pendingDelete = null;
	}}
>
	<AlertDialog.Content preventOverflowTextSelection={false}>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this photo?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes it from your profile and deletes it from Grindr's servers.
				It can't be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive/10 hover:bg-destructive/20 text-destructive border-destructive/20"
				onclick={() => void confirmDelete()}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
