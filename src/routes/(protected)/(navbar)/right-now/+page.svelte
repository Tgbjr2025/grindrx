<script lang="ts">
	import { LightningIcon, PlusIcon, UserIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import { getPreferences } from "$lib/app-data/preferences.svelte";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as Drawer from "$lib/components/ui/drawer";
	import * as Empty from "$lib/components/ui/empty";
	import { Spinner } from "$lib/components/ui/spinner";
	import { formatDistance } from "$lib/utils/distance";
	import { getGrid, profileCache } from "../(root)/grid";

	const feed = getPreferences().then(({ geohash }) => {
		if (!geohash) throw new Error("Location not set — open Browse first.");
		return getGrid({ nearbyGeoHash: geohash, rightNow: true, onlineOnly: true });
	});

	// Post Right Now state
	let drawerOpen = $state(false);
	let posting = $state(false);
	let clearing = $state(false);
	let rightNowText = $state("");
	let rightNowStatus = $state<"HOSTING" | "NOT_HOSTING">("NOT_HOSTING");

	async function postRightNow() {
		if (posting) return;
		posting = true;
		try {
			const body: Record<string, string> = { rightNowStatus };
			if (rightNowText.trim()) body.rightNowText = rightNowText.trim();
			await fetchRest("/v4/me/rightnow", { method: "POST", body });
			toast.success("Right Now posted!");
			drawerOpen = false;
		} catch {
			toast.error("Failed to post Right Now status.");
		} finally {
			posting = false;
		}
	}

	async function clearRightNow() {
		if (clearing) return;
		clearing = true;
		try {
			await fetchRest("/v4/me/rightnow", { method: "DELETE" });
			toast.success("Right Now status cleared.");
			drawerOpen = false;
		} catch {
			toast.error("Failed to clear Right Now status.");
		} finally {
			clearing = false;
		}
	}
</script>

<div class="px-4 flex-1 flex flex-col">
	<!-- Post Right Now button -->
	<div class="pt-3 pb-1">
		<button
			type="button"
			class="w-full flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted/60 active:bg-muted transition-colors"
			onclick={() => (drawerOpen = true)}
		>
			<PlusIcon class="size-4 shrink-0" />
			<span>Post your Right Now status…</span>
		</button>
	</div>

	{#await feed}
		<div class="flex flex-1 items-center justify-center">
			<Spinner class="size-6" />
		</div>
	{:then { items }}
		{@const profiles = items.filter((i) => i.type === "full")}
		{#if profiles.length === 0}
			<Empty.Root>
				<Empty.Header>
					<Empty.Media variant="icon">
						<LightningIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>Nobody right now</Empty.Title>
					<Empty.Description>Check back soon — people post when they're available.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<ul class="flex flex-col py-2">
				{#each profiles as item (item.id)}
					{@const cached = profileCache.get(item.id)}
					{@const imageHash = cached?.profilePhotosHashes?.[0] ?? item.profilePhotosHashes?.[0] ?? null}
					{@const name = cached?.displayName ?? item.displayName ?? "Anonymous"}
					<li>
						<a
							href="/profile/{item.id}"
							class="flex items-center gap-3 hover:bg-muted/60 active:bg-muted transition-colors rounded-2xl px-3 py-2.5"
						>
							<div class="size-14 rounded-2xl bg-muted shrink-0 overflow-hidden flex items-center justify-center">
								{#if imageHash}
									<img
										src="https://cdns.grindr.com/images/thumb/320x320/{imageHash}"
										alt="{name}'s profile"
										class="w-full h-full object-cover"
										loading="lazy"
										draggable="false"
									/>
								{:else}
									<UserIcon weight="fill" color="var(--color-stone-400)" class="size-8" />
								{/if}
							</div>
							<div class="flex flex-col gap-0.5 min-w-0 flex-1">
								<span class="font-semibold truncate">{name}</span>
								{#if item.distance !== null}
									<span class="text-xs text-muted-foreground/70">
										{formatDistance(item.distance, getDistanceUnit())} away
									</span>
								{/if}
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{:catch error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-destructive text-sm font-medium">
				{error instanceof Error ? error.message : "Failed to load Right Now feed."}
			</p>
		</div>
	{/await}
</div>

<!-- Post Right Now drawer -->
<Drawer.Root bind:open={drawerOpen}>
	<Drawer.Content>
		<Drawer.Header>
			<Drawer.Title>Post Right Now</Drawer.Title>
		</Drawer.Header>
		<div class="px-4 flex flex-col gap-4 pb-2">
			<!-- Optional text -->
			<div class="flex flex-col gap-1.5">
				<label for="rightnow-text" class="text-sm font-medium">What are you up to? <span class="text-muted-foreground font-normal">(optional)</span></label>
				<input
					id="rightnow-text"
					type="text"
					placeholder="e.g. Looking to hang out"
					maxlength="255"
					bind:value={rightNowText}
					class="w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
				/>
			</div>
			<!-- Status radio -->
			<div class="flex flex-col gap-1.5">
				<span class="text-sm font-medium">Status</span>
				<div class="flex gap-2">
					<button
						type="button"
						class={[
							"flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
							rightNowStatus === "HOSTING"
								? "border-primary bg-primary/10 text-primary"
								: "border-border bg-muted text-muted-foreground hover:bg-muted/80",
						]}
						onclick={() => (rightNowStatus = "HOSTING")}
					>
						Hosting
					</button>
					<button
						type="button"
						class={[
							"flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
							rightNowStatus === "NOT_HOSTING"
								? "border-primary bg-primary/10 text-primary"
								: "border-border bg-muted text-muted-foreground hover:bg-muted/80",
						]}
						onclick={() => (rightNowStatus = "NOT_HOSTING")}
					>
						Not Hosting
					</button>
				</div>
			</div>
		</div>
		<Drawer.Footer>
			<Button
				variant="default"
				class="w-full"
				disabled={posting}
				onclick={postRightNow}
			>
				{posting ? "Posting…" : "Post"}
			</Button>
			<Button
				variant="outline"
				class="w-full"
				disabled={clearing}
				onclick={clearRightNow}
			>
				{clearing ? "Clearing…" : "Clear status"}
			</Button>
		</Drawer.Footer>
	</Drawer.Content>
</Drawer.Root>
