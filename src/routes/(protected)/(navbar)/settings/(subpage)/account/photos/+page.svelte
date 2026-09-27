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
		getProfileUploadedPhotos,
		MAX_SECONDARY_PROFILE_PHOTOS,
		setProfilePhotos,
		uploadProfilePhoto,
	} from "$lib/api/profile";
	import { Button } from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";

	type Photo = { mediaHash: string; type: number; state: number };

	let photos = $state<Photo[]>([]);
	// The photo shown as the profile's main picture. The API stores this
	// separately from the ordered list, so it is tracked here rather than
	// inferred from `photos[0]` (the GET endpoint does not label it).
	let primaryHash = $state<string | null>(null);
	// Everything else, in display order.
	let secondary = $state<string[]>([]);
	// IS `primaryHash` actually the server's primary, or our guess at it?
	//
	// `GET /v3/me/profile/images` returns an ordered `medias` array and does NOT
	// say which entry is primary. The first cold load therefore ASSUMES
	// `medias[0]` is primary — and that assumption used to be written straight
	// back to the server. If the user's real primary was, say, entry 3, the very
	// first arrow tap issued a PUT with the wrong photo promoted to main: the
	// primary silently changed, and `load()` (which only re-derives when
	// `!primaryHash`) never corrected it. So we track the assumption explicitly
	// and refuse to persist while it holds.
	let primaryIsAssumed = $state(false);

	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state<Set<string>>(new Set());
	let uploading = $state(false);
	let saving = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	// --- Serialised mutations (D10) ----------------------------------------
	// `move`/`makePrimary` were `async` and each called `persist()` itself, so
	// four rapid arrow taps issued FOUR overlapping PUTs with four different
	// orderings and no ordering guarantee between them: the last request to
	// ARRIVE won, which is not necessarily the last one sent. `saving` was set
	// but never read by the mutators, so nothing serialised or blocked them.
	// Every mutation now goes through one promise chain, and the arrows are
	// disabled while a write is in flight.
	let writeChain: Promise<unknown> = Promise.resolve();
	function enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = writeChain.then(task, task);
		// Keep the chain alive after a rejection so one failure does not wedge
		// every later mutation.
		writeChain = run.catch(() => undefined);
		return run;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await getProfileUploadedPhotos();
			photos = res.medias;
			// The GET endpoint does not tell us which photo is primary, so on a
			// cold load we keep whatever the user last set in this session and
			// otherwise fall back to server order with the first photo as main.
			const known = new Set(res.medias.map((p) => p.mediaHash));
			if (primaryHash && !known.has(primaryHash)) {
				primaryHash = null;
				// The hash we had was deleted server-side, so the old assumption
				// no longer describes anything; re-derive it from server order.
				primaryIsAssumed = true;
			}
			secondary = secondary.filter((h) => known.has(h));
			if (!primaryHash && res.medias.length > 0) {
				primaryHash = res.medias[0].mediaHash;
				secondary = res.medias.slice(1).map((p) => p.mediaHash);
				primaryIsAssumed = true;
			}
		} catch {
			error = "Failed to load photos.";
		} finally {
			loading = false;
		}
	}

	void load();

	function setBusy(hash: string, on: boolean) {
		const next = new Set(busy);
		if (on) next.add(hash);
		else next.delete(hash);
		busy = next;
	}

	/**
	 * Push the current primary + ordering to the API.
	 *
	 * REFUSES while `primaryIsAssumed` is set. The order we would send is built
	 * from a guess about which photo is primary, and a PUT makes that guess
	 * authoritative — so the first mutation after a cold load would otherwise
	 * silently promote the wrong photo to main and rewrite the user's real
	 * ordering around it. The mutation is still applied optimistically in the UI
	 * (so the tap visibly does something); it just is not written until the
	 * primary is one the SERVER chose, which happens as soon as the user
	 * explicitly picks a main photo or uploads one.
	 */
	async function persist() {
		if (primaryIsAssumed) return false;
		saving = true;
		try {
			await setProfilePhotos({
				primaryImageHash: primaryHash,
				secondaryImageHashes: secondary,
			});
			return true;
		} finally {
			saving = false;
		}
	}

	async function makePrimary(hash: string) {
		if (primaryHash === hash) return;
		const previousPrimary = primaryHash;
		const previousSecondary = secondary;
		const previousAssumed = primaryIsAssumed;
		// Optimistic: swap into the main slot and push the old main down the list.
		primaryHash = hash;
		secondary = [
			previousPrimary,
			...secondary.filter((h) => h !== hash),
		].filter((h): h is string => h != null);
		// The user has now named the primary themselves, so the assumption is
		// resolved and the state is safe to write.
		primaryIsAssumed = false;
		try {
			const wrote = await enqueue(() => persist());
			if (!wrote) {
				// persist() bailed: put the assumption back so a later mutation
				// still refuses to write.
				primaryIsAssumed = previousAssumed;
				toast.error("Couldn't confirm your main photo. Try again.");
				return;
			}
			toast.success("Main photo updated.");
		} catch (err) {
			primaryHash = previousPrimary;
			secondary = previousSecondary;
			primaryIsAssumed = previousAssumed;
			console.error("Failed to set main photo", err);
			toast.error("Couldn't update your main photo.");
		}
	}

	/** Nudge a secondary photo one slot left/right in the displayed order. */
	async function move(hash: string, direction: -1 | 1) {
		const index = secondary.indexOf(hash);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= secondary.length) return;
		const next = [...secondary];
		[next[index], next[target]] = [next[target], next[index]];
		const previous = secondary;
		secondary = next;
		try {
			await enqueue(() => persist());
		} catch (err) {
			secondary = previous;
			console.error("Failed to reorder photos", err);
			toast.error("Couldn't reorder photos.");
		}
	}

	async function handleFileChosen(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		// Reset so choosing the same file again re-fires `change`.
		input.value = "";
		if (!file) return;

		uploading = true;
		try {
			const hash = await uploadProfilePhoto(file);
			if (!primaryHash) {
				// The user has now named the primary, so the "first photo is
				// main" assumption no longer holds and a PUT is safe.
				primaryHash = hash;
				primaryIsAssumed = false;
			} else if (secondary.length < MAX_SECONDARY_PROFILE_PHOTOS) {
				secondary = [...secondary, hash];
			} else {
				toast.error(
					`You can show ${MAX_SECONDARY_PROFILE_PHOTOS + 1} photos. Remove one first.`,
				);
				// The bytes reached the CDN but we cannot reference it; make that
				// explicit rather than appearing to succeed.
				console.warn("Uploaded a photo that could not be added: album limit");
				await deletePhoto(hash, { silent: true });
				return;
			}
			// Serialised with any in-flight reorder, so the PUT that lands carries
			// the ordering the user can see.
			await enqueue(() => persist());
			// Re-read so the server's response to OUR write is reflected (a new
			// photo can be rejected, or the server can normalise the order). This
			// does NOT reconcile a wrong primary assumption: `load()` only
			// re-derives when `primaryHash` is unset, which is never true after a
			// mutation — see `primaryIsAssumed`.
			await load();
			toast.success("Photo added.");
		} catch (err) {
			console.error("Failed to add photo", err);
			const detail =
				err instanceof Error ? `: ${err.message.slice(0, 120)}` : "";
			toast.error(`Failed to add photo${detail}`, { duration: 15000 });
		} finally {
			uploading = false;
		}
	}

	async function deletePhoto(hash: string, opts: { silent?: boolean } = {}) {
		setBusy(hash, true);
		activeSheet = null;
		const prevPhotos = photos;
		const prevPrimary = primaryHash;
		const prevSecondary = secondary;
		photos = photos.filter((p) => p.mediaHash !== hash);
		if (primaryHash === hash) {
			primaryHash = secondary[0] ?? null;
			// The deleted photo was the one we ASSUMED was primary, so the next
			// photo is a fresh guess, not a server-confirmed fact.
			primaryIsAssumed = true;
		}
		secondary = secondary.filter((h) => h !== hash);
		try {
			// PRIVACY-CRITICAL: the documented delete is `DELETE /v3/me/profile/images`
			// with a JSON *body* `{ media_hashes: [...] }` (see
			// docs/content/grindr-api/users/profiles.md#delete-profile-photos). It
			// removes the photo from the profile AND deletes the media from the CDN.
			// The previous path-param form `DELETE /v3.1/me/profile/images/{hash}` is
			// not a real endpoint — it returned without deleting, so removed photos
			// reappeared on reload ("delete doesn't stick"). Grindr treats deletes as
			// idempotent, so re-deleting an already-gone hash is safe.
			const res = await fetchRest("/v3/me/profile/images", {
				method: "DELETE",
				body: { media_hashes: [hash] },
			});
			if (res.status < 200 || res.status >= 300) {
				throw new Error(`HTTP ${res.status}`);
			}
			// Keep the remaining photos' primary/ordering in sync — but only when
			// the primary is server-confirmed. A DELETE, unlike a PUT, does not
			// set the primary, so writing a guessed one here would be the same
			// data-loss bug as an arrow tap; persist() refuses and skips instead.
			await enqueue(() => persist());
			if (!opts.silent) toast.success("Photo deleted.");
		} catch {
			photos = prevPhotos;
			primaryHash = prevPrimary;
			secondary = prevSecondary;
			if (!opts.silent) toast.error("Failed to delete photo.");
		} finally {
			setBusy(hash, false);
		}
	}

	// which photo hash has its action sheet open
	let activeSheet = $state<string | null>(null);

	let pendingDelete = $state<string | null>(null);

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

<!-- Backdrop to close action sheet -->
{#if activeSheet !== null || pendingDelete !== null}
	<button
		type="button"
		aria-label="Close"
		class="fixed inset-0 z-40"
		onclick={() => {
			activeSheet = null;
			pendingDelete = null;
		}}
	></button>
{/if}

<div class="flex w-full px-4">
	<main
		class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-2"
	>
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<p class="text-sm text-muted-foreground">
					Add photos, choose the one people see first, and reorder the rest.
				</p>
			</div>
			<Button
				size="sm"
				class="shrink-0"
				disabled={uploading || saving}
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

		{#if primaryHash}
			<p class="text-xs text-muted-foreground px-1">
				Your main photo — this is what other people see in the grid.
			</p>
			<div class="relative aspect-square w-full max-w-64 m-auto">
				<img
					src="https://cdns.grindr.com/images/thumb/320x320/{primaryHash}"
					alt="Shown first in the grid"
					class="w-full h-full object-cover rounded-2xl bg-muted"
					draggable="false"
					loading="lazy"
				/>
				<span
					class="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white"
				>
					<StarIcon weight="fill" class="size-3" />
					Main
				</span>
				{#if busy.has(primaryHash)}
					<div class="absolute inset-0 flex items-center justify-center">
						<Spinner class="size-6 text-white" />
					</div>
				{/if}
			</div>
		{/if}

		{#if loading}
			<div class="flex flex-1 min-h-40 items-center justify-center">
				<Spinner class="size-6" />
			</div>
		{:else if error}
			<p class="text-destructive text-sm text-center pt-10">{error}</p>
		{:else if photos.length === 0}
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
			{#if secondary.length > 0}
				<p class="text-xs text-muted-foreground px-1">
					{secondary.length} of {MAX_SECONDARY_PROFILE_PHOTOS} extra photos shown.
					Use the arrows to reorder.
				</p>
			{/if}
			<!--
				Honest about the one thing this screen cannot know: the API does not
				report which photo is primary, so the "Main" slot above may be our
				guess. Say so rather than implying the ordering has been confirmed,
				and explain why reordering is therefore not being written yet.
			-->
			{#if primaryIsAssumed && secondary.length > 0}
				<p class="text-xs text-muted-foreground px-1">
					Reordering isn't saved until you choose a main photo — Grindr's API
					doesn't report which photo is currently main, so we won't overwrite
					your real order with a guess.
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
							onclick={() => (activeSheet = isActive ? null : hash)}
						>
							<img
								src="https://cdns.grindr.com/images/thumb/320x320/{hash}"
								alt="Profile photo {i + 2}"
								class="w-full h-full object-cover transition-opacity"
								class:opacity-40={isBusy}
								draggable="false"
								loading="lazy"
							/>
							{#if isBusy}
								<div class="absolute inset-0 flex items-center justify-center">
									<Spinner class="size-5 text-white" />
								</div>
							{/if}
						</button>

						<!--
							Arrows are disabled while a write is in flight (D10): four
							rapid taps used to issue four overlapping PUTs with four
							orderings and no arrival-order guarantee. Writes are also
							serialised through `enqueue`, so this is belt-and-braces —
							the UI must not invite a race the code now prevents.
						-->
						{#if !isBusy}
							<div
								class="absolute top-1 left-1 right-1 flex items-center justify-between"
							>
								<button
									type="button"
									aria-label="Move photo earlier"
									disabled={i === 0 || saving}
									class="size-6 rounded-full bg-black/60 flex items-center justify-center disabled:opacity-30"
									onclick={() => void move(hash, -1)}
								>
									<ArrowLeftIcon weight="bold" class="size-3 text-white" />
								</button>
								<button
									type="button"
									aria-label="Move photo later"
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
								class="absolute bottom-1.5 left-1 right-1 z-50 flex flex-col gap-1 rounded-xl overflow-hidden shadow-xl border border-border bg-popover text-[13px]"
							>
								<button
									type="button"
									class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium"
									onclick={() => {
										activeSheet = null;
										void makePrimary(hash);
									}}
								>
									<StarIcon weight="fill" class="size-3.5 shrink-0" />
									Make main photo
								</button>
								<button
									type="button"
									class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium text-destructive"
									onclick={() => (pendingDelete = hash)}
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
	Deleting a photo also purges it from Grindr's CDN, so it gets a real
	confirmation instead of the tap-to-open-sheet flow the other actions use.
-->
{#if pendingDelete !== null}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6"
		role="alertdialog"
		aria-modal="true"
		aria-label="Delete photo?"
	>
		<button
			type="button"
			aria-label="Cancel"
			class="absolute inset-0 bg-black/60"
			onclick={() => (pendingDelete = null)}
		></button>
		<div
			class="relative w-full max-w-80 rounded-2xl border border-border bg-popover p-5 flex flex-col gap-4"
		>
			<div class="flex flex-col gap-1.5">
				<p class="font-semibold">Delete this photo?</p>
				<p class="text-sm text-muted-foreground">
					This removes it from your profile and deletes it from Grindr's
					servers. It can't be undone.
				</p>
			</div>
			<div class="flex gap-2 justify-end">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => (pendingDelete = null)}
				>
					Cancel
				</Button>
				<Button
					size="sm"
					class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					onclick={() => void confirmDelete()}
				>
					Delete
				</Button>
			</div>
		</div>
	</div>
{/if}
