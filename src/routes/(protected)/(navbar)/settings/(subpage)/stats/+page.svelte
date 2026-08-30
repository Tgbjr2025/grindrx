<script lang="ts">
	import { DownloadSimpleIcon, UsersIcon } from "phosphor-svelte";
	import { onMount } from "svelte";

	import { fetchActiveUsers, fetchDownloadStats } from "$lib/api/usage";
	import { Spinner } from "$lib/components/ui/spinner";
	import type { ActiveUsers, DownloadStats } from "$lib/utils/stats";

	let downloads = $state<DownloadStats | null>(null);
	let downloadsLoading = $state(true);
	let downloadsError = $state(false);

	let active = $state<ActiveUsers | null>(null);
	let activeLoading = $state(true);
	let activeError = $state(false);

	onMount(() => {
		fetchDownloadStats()
			.then((data) => (downloads = data))
			.catch(() => (downloadsError = true))
			.finally(() => (downloadsLoading = false));
		fetchActiveUsers()
			.then((data) => (active = data))
			.catch(() => (activeError = true))
			.finally(() => (activeLoading = false));
	});

	function fmt(n: number): string {
		return n.toLocaleString();
	}
</script>

<div class="flex w-full px-4">
	<main class="pb-18 flex flex-col gap-4 w-full max-w-120 m-auto">
		<!-- Active users -->
		<section class="rounded-2xl border border-border p-4">
			<div class="flex items-center gap-2 mb-3">
				<UsersIcon class="size-5 text-primary" weight="fill" />
				<h2 class="text-lg font-semibold">Active users</h2>
			</div>

			{#if activeLoading}
				<div class="flex justify-center py-6"><Spinner class="size-6" /></div>
			{:else if activeError || !active}
				<p class="text-sm text-muted-foreground">Couldn't load active-user stats.</p>
			{:else}
				<div class="grid grid-cols-3 gap-2 text-center">
					<div class="rounded-xl bg-muted/60 py-3">
						<div class="text-2xl font-bold">{fmt(active.active1h)}</div>
						<div class="text-xs text-muted-foreground">last hour</div>
					</div>
					<div class="rounded-xl bg-muted/60 py-3">
						<div class="text-2xl font-bold">{fmt(active.active24h)}</div>
						<div class="text-xs text-muted-foreground">last 24h</div>
					</div>
					<div class="rounded-xl bg-muted/60 py-3">
						<div class="text-2xl font-bold">{fmt(active.active7d)}</div>
						<div class="text-xs text-muted-foreground">last 7 days</div>
					</div>
				</div>
				{#if active.byVersion.length > 0}
					<div class="mt-3">
						<p class="text-xs text-muted-foreground mb-1">Active (24h) by version</p>
						<div class="flex flex-col gap-1">
							{#each active.byVersion as v (v.version)}
								<div class="flex justify-between text-sm">
									<span class="font-mono">{v.version}</span>
									<span class="font-medium">{fmt(v.count)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
				<p class="mt-3 text-[11px] text-muted-foreground/70">
					Counted from anonymous launch pings (per-install id + version, no personal
					data), over a rolling 7-day window.
				</p>
			{/if}
		</section>

		<!-- Downloads -->
		<section class="rounded-2xl border border-border p-4">
			<div class="flex items-center gap-2 mb-3">
				<DownloadSimpleIcon class="size-5 text-primary" weight="fill" />
				<h2 class="text-lg font-semibold">Downloads</h2>
			</div>

			{#if downloadsLoading}
				<div class="flex justify-center py-6"><Spinner class="size-6" /></div>
			{:else if downloadsError || !downloads}
				<p class="text-sm text-muted-foreground">Couldn't load download stats.</p>
			{:else}
				<div class="rounded-xl bg-primary/10 py-4 text-center mb-3">
					<div class="text-3xl font-bold text-primary">{fmt(downloads.total)}</div>
					<div class="text-xs text-muted-foreground">total across all versions & repos</div>
				</div>
				<div class="grid grid-cols-2 gap-2 text-center mb-3">
					<div class="rounded-xl bg-muted/60 py-3">
						<div class="text-xl font-bold">{fmt(downloads.github.total)}</div>
						<div class="text-xs text-muted-foreground">GitHub</div>
					</div>
					<div class="rounded-xl bg-muted/60 py-3">
						<div class="text-xl font-bold">{fmt(downloads.forgejo.total)}</div>
						<div class="text-xs text-muted-foreground">Forgejo</div>
					</div>
				</div>
				{#if downloads.combined.length > 0}
					<p class="text-xs text-muted-foreground mb-1">By version (both repos)</p>
					<div class="flex flex-col gap-1">
						{#each downloads.combined as v (v.tag)}
							<div class="flex justify-between text-sm">
								<span class="font-mono">{v.tag}</span>
								<span class="font-medium">{fmt(v.count)}</span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</section>
	</main>
</div>
