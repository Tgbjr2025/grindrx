<script lang="ts">
	import { UserIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";
	import z from "zod";

	import { onMount } from "svelte";

	import { fetchRest } from "$lib/api";
	import * as Button from "$lib/components/ui/button";
	import * as Empty from "$lib/components/ui/empty";
	import * as Item from "$lib/components/ui/item";
	import { Spinner } from "$lib/components/ui/spinner";

	const hiddenProfileSchema = z.object({
		profileId: z.coerce.number().int().nonnegative(),
		displayName: z.string().nullable(),
		profileImageMediaHash: z.string().nullable(),
	});

	const hidesResponseSchema = z.object({
		profiles: z.array(hiddenProfileSchema),
	});

	type HiddenProfile = z.infer<typeof hiddenProfileSchema>;

	let hiddenProfiles = $state<HiddenProfile[]>([]);
	let loading = $state(true);
	let fetchError = $state<string | null>(null);
	let unhiding = $state<Set<number>>(new Set());

	async function loadHidden() {
		loading = true;
		fetchError = null;
		try {
			const res = await fetchRest("/v1/hides", { method: "GET" });
			const data = res.jsonParsed(hidesResponseSchema);
			hiddenProfiles = data.profiles;
		} catch (err) {
			console.error("Failed to load hidden users", err);
			fetchError = "Failed to load hidden users.";
		} finally {
			loading = false;
		}
	}

	async function unhide(profileId: number) {
		unhiding = new Set([...unhiding, profileId]);
		try {
			await fetchRest(`/v1/hides/${profileId}`, { method: "DELETE" });
			hiddenProfiles = hiddenProfiles.filter((p) => p.profileId !== profileId);
		} catch (err) {
			console.error("Failed to unhide user", err);
			toast.error("Failed to unhide user. Please try again.");
		} finally {
			const next = new Set(unhiding);
			next.delete(profileId);
			unhiding = next;
		}
	}

	onMount(() => {
		loadHidden().catch((err) => console.error(err));
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
				<Button.Root variant="outline" onclick={() => loadHidden().catch((e) => console.error(e))}>
					Try again
				</Button.Root>
			</div>
		{:else if hiddenProfiles.length === 0}
			<Empty.Root class="flex-1">
				<Empty.Header>
					<Empty.Media variant="icon">
						<UserIcon weight="fill" />
					</Empty.Media>
					<Empty.Title>No hidden users</Empty.Title>
					<Empty.Description>
						Users you hide will appear here. You can unhide them at any time.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			{#each hiddenProfiles as profile (profile.profileId)}
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
							disabled={unhiding.has(profile.profileId)}
							onclick={() => unhide(profile.profileId).catch((e) => console.error(e))}
						>
							{unhiding.has(profile.profileId) ? "Unhiding…" : "Unhide"}
						</Button.Root>
					</Item.Actions>
				</Item.Root>
			{/each}
		{/if}
	</main>
</div>
