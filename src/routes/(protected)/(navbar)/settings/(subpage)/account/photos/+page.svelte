<script lang="ts">
	import { ImageIcon, StarIcon, TrashIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { getProfileUploadedPhotos } from "$lib/api/profile";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";

	type Photo = { mediaHash: string; type: number; state: number };

	let photos = $state<Photo[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state<Set<string>>(new Set());
	// which photo hash has its action sheet open
	let activeHash = $state<string | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await getProfileUploadedPhotos();
			photos = res.medias;
		} catch {
			error = "Failed to load photos.";
		} finally {
			loading = false;
		}
	}

	load();

	async function deletePhoto(hash: string) {
		busy = new Set([...busy, hash]);
		activeHash = null;
		const prev = [...photos];
		photos = photos.filter((p) => p.mediaHash !== hash);
		try {
			await fetchRest(`/v3.1/me/profile/images/${hash}`, { method: "DELETE" });
			toast.success("Photo deleted.");
		} catch {
			photos = prev;
			toast.error("Failed to delete photo.");
		} finally {
			const next = new Set(busy);
			next.delete(hash);
			busy = next;
		}
	}

	async function setAsPrimary(hash: string) {
		if (photos[0]?.mediaHash === hash) return;
		busy = new Set([...busy, hash]);
		activeHash = null;
		const prev = [...photos];
		// Optimistically move to front
		photos = [
			photos.find((p) => p.mediaHash === hash)!,
			...photos.filter((p) => p.mediaHash !== hash),
		];
		try {
			// Grindr uses ordered mediaHashes PUT to reorder profile images
			await fetchRest("/v3.1/me/profile/images", {
				method: "PUT",
				body: { mediaHashes: photos.map((p) => p.mediaHash) },
			});
			toast.success("Primary photo updated.");
		} catch {
			photos = prev;
			toast.error("Failed to update primary photo.");
		} finally {
			const next = new Set(busy);
			next.delete(hash);
			busy = next;
		}
	}
</script>

<!-- Backdrop to close action sheet -->
{#if activeHash !== null}
	<button
		type="button"
		aria-label="Close"
		class="fixed inset-0 z-40"
		onclick={() => (activeHash = null)}
	></button>
{/if}

<div class="flex w-full px-4">
	<main class="pb-(--content-pb) flex flex-col gap-4 w-full max-w-120 m-auto pt-2">
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
					<Empty.Description>Upload photos in the Grindr app to manage them here.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<p class="text-xs text-muted-foreground px-1">
				Tap a photo to set it as primary or delete it. The first photo is your profile picture.
			</p>
			<div class="grid grid-cols-3 gap-1.5">
				{#each photos as photo, i (photo.mediaHash)}
					{@const isPrimary = i === 0}
					{@const isBusy = busy.has(photo.mediaHash)}
					{@const isActive = activeHash === photo.mediaHash}
					<div class="relative aspect-square">
						<button
							type="button"
							class="w-full h-full rounded-xl overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring"
							disabled={isBusy}
							onclick={() => (activeHash = isActive ? null : photo.mediaHash)}
						>
							<img
								src="https://cdns.grindr.com/images/thumb/320x320/{photo.mediaHash}"
								alt="Profile photo {i + 1}"
								class="w-full h-full object-cover transition-opacity"
								class:opacity-40={isBusy}
								draggable="false"
								loading="lazy"
							/>
							{#if isPrimary}
								<span class="absolute top-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10px] font-semibold text-yellow-400">
									<StarIcon weight="fill" class="size-2.5" />
									Main
								</span>
							{/if}
							{#if isBusy}
								<div class="absolute inset-0 flex items-center justify-center">
									<Spinner class="size-5 text-white" />
								</div>
							{/if}
						</button>

						{#if isActive && !isBusy}
							<div class="absolute bottom-1.5 left-1 right-1 z-50 flex flex-col gap-1 rounded-xl overflow-hidden shadow-xl border border-border bg-popover text-[13px]">
								{#if !isPrimary}
									<button
										type="button"
										class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium"
										onclick={() => setAsPrimary(photo.mediaHash)}
									>
										<StarIcon weight="fill" class="size-3.5 text-yellow-400 shrink-0" />
										Set as primary
									</button>
								{/if}
								<button
									type="button"
									class="flex items-center gap-2 px-3 py-2.5 hover:bg-muted transition-colors font-medium text-destructive"
									onclick={() => deletePhoto(photo.mediaHash)}
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
