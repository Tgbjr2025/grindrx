<script lang="ts">
	import { UserIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import z from "zod";

	import { onMount } from "svelte";

	import { fetchRest } from "$lib/api";
	import { unblockProfile } from "$lib/api/block";
	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";

	const blockedProfileSchema = z.object({
		profileId: z.coerce.number().int().nonnegative(),
		displayName: z.string().nullable(),
		profileImageMediaHash: z.string().nullable(),
	});

	const blocksResponseSchema = z.object({
		profiles: z.array(blockedProfileSchema),
	});

	type BlockedProfile = z.infer<typeof blockedProfileSchema>;

	let blockedProfiles = $state<BlockedProfile[]>([]);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);
	let unblocking = $state<Set<number>>(new Set());

	async function loadBlocked() {
		loading = true;
		fetchError = null;
		try {
			const res = await fetchRest("/v1/blocks", { method: "GET" });
			const data = res.jsonParsed(blocksResponseSchema);
			blockedProfiles = data.profiles;
		} catch (err) {
			console.error("Failed to load blocked users", err);
			fetchError = "Failed to load blocked users.";
		} finally {
			loading = false;
		}
	}

	async function unblock(profileId: number) {
		unblocking = new Set([...unblocking, profileId]);
		try {
			await unblockProfile(profileId);
			blockedProfiles = blockedProfiles.filter((p) => p.profileId !== profileId);
		} catch (err) {
			console.error("Failed to unblock user", err);
			toast.error("Failed to unblock user. Please try again.");
		} finally {
			const next = new Set(unblocking);
			next.delete(profileId);
			unblocking = next;
		}
	}

	onMount(() => {
		loadBlocked().catch((err) => console.error(err));
	});
</script>

<div class="flex w-full px-4 flex-1">
	<main class="pb-(--content-pb) flex flex-col gap-3 w-full max-w-120 m-auto pt-4 flex-1">
		{#if loading}
			<div class="flex flex-1 items-center justify-center py-16">
				<Spinner class="size-8" />
			</div>
		{:else if fetchError}
			<div class="flex flex-1 flex-col items-center justify-center gap-4 py-16">
				<p class="text-destructive text-sm">{fetchError}</p>
				<Button.Root variant="outline" onclick={() => loadBlocked().catch((e) => console.error(e))}>
					Try again
				</Button.Root>
			</div>
		{:else if blockedProfiles.length === 0}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<UserIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No blocked users</Empty.Title>
					<Empty.Description>
						Users you block will appear here. You can unblock them at any time.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			{#each blockedProfiles as profile (profile.profileId)}
				<Item.Root variant="outline">
					<Item.Media>
						<div class="relative size-10 shrink-0 rounded-xl overflow-hidden bg-muted">
							{#if profile.profileImageMediaHash}
								<img
									src="https://cdns.grindr.com/images/thumb/320x320/{profile.profileImageMediaHash}"
									alt="Profile avatar"
									class="w-full h-full object-cover"
									loading="lazy"
									draggable="false"
								/>
							{:else}
								<UserIcon
									weight="fill"
									class="size-3/4 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
								/>
							{/if}
						</div>
					</Item.Media>
					<Item.Content class="min-w-0 flex-1">
						<Item.Title class="truncate min-w-0">
							{profile.displayName ?? "Anonymous"}
						</Item.Title>
					</Item.Content>
					<Item.Actions>
						<Button.Root
							variant="outline"
							size="sm"
							disabled={unblocking.has(profile.profileId)}
							onclick={() => unblock(profile.profileId).catch((e) => console.error(e))}
						>
							{unblocking.has(profile.profileId) ? "Unblocking…" : "Unblock"}
						</Button.Root>
					</Item.Actions>
				</Item.Root>
			{/each}
		{/if}
	</main>
</div>
