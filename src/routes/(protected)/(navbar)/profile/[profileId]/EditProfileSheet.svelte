<script lang="ts">
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import * as Sheet from "$lib/components/ui/sheet";
	import Textarea from "$lib/components/ui/textarea/textarea.svelte";
	import {
		type BodyTypeId,
		bodyTypes,
		ethnicities,
		type EthnicityId,
		type LookingForId,
		lookingFor as lookingForLabels,
		relationshipStatuses,
		type RelationshipStatusId,
		type SexualPositionId,
		sexualPositions,
		type TribeId,
		tribes as tribeLabels,
	} from "$lib/model/profile";

	let {
		open = $bindable(false),
		profileData,
		onSave,
	}: {
		open: boolean;
		profileData: {
			displayName: string | null;
			aboutMe: string | null;
			sexualPosition: SexualPositionId | null | undefined;
			bodyType: BodyTypeId | null;
			height: number | null;
			weight: number | null;
			ethnicity: EthnicityId | null;
			relationshipStatus: RelationshipStatusId | null;
			lookingFor: LookingForId[];
			grindrTribes: TribeId[];
		};
		onSave: () => void;
	} = $props();

	// Form state — initialised each time the sheet opens
	let displayName = $state<string>(profileData.displayName ?? "");
	let aboutMe = $state<string>(profileData.aboutMe ?? "");
	let sexualPosition = $state<SexualPositionId | "">(profileData.sexualPosition ?? "");
	let bodyType = $state<BodyTypeId | "">(profileData.bodyType ?? "");
	let height = $state<string>(profileData.height !== null ? String(profileData.height) : "");
	let weight = $state<string>(profileData.weight !== null ? String(Math.round(profileData.weight / 1000)) : "");
	let ethnicity = $state<EthnicityId | "">(profileData.ethnicity ?? "");
	let relationshipStatus = $state<RelationshipStatusId | "">(
		profileData.relationshipStatus ?? "",
	);
	let selectedLookingFor = $state<Set<LookingForId>>(new Set(profileData.lookingFor));
	let selectedTribes = $state<Set<TribeId>>(new Set(profileData.grindrTribes));

	let saving = $state(false);
	let contentScroll = $state(0);

	// Reset form when the sheet is opened
	$effect(() => {
		if (open) {
			displayName = profileData.displayName ?? "";
			aboutMe = profileData.aboutMe ?? "";
			sexualPosition = profileData.sexualPosition ?? "";
			bodyType = profileData.bodyType ?? "";
			height = profileData.height !== null ? String(profileData.height) : "";
			weight = profileData.weight !== null ? String(Math.round(profileData.weight / 1000)) : "";
			ethnicity = profileData.ethnicity ?? "";
			relationshipStatus = profileData.relationshipStatus ?? "";
			selectedLookingFor = new Set(profileData.lookingFor);
			selectedTribes = new Set(profileData.grindrTribes);
		}
	});

	function toggleLookingFor(id: LookingForId) {
		const next = new Set(selectedLookingFor);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedLookingFor = next;
	}

	function toggleTribe(id: TribeId) {
		const next = new Set(selectedTribes);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedTribes = next;
	}

	async function handleSave() {
		saving = true;
		try {
			const body: Record<string, unknown> = {
				displayName: displayName.trim() !== "" ? displayName.trim() : null,
				aboutMe: aboutMe.trim() !== "" ? aboutMe.trim() : null,
				sexualPosition: sexualPosition !== "" ? sexualPosition : null,
				bodyType: bodyType !== "" ? bodyType : null,
				height: height !== "" ? Number(height) : null,
				weight: weight !== "" ? Number(weight) * 1000 : null,
				ethnicity: ethnicity !== "" ? ethnicity : null,
				relationshipStatus: relationshipStatus !== "" ? relationshipStatus : null,
				lookingFor: Array.from(selectedLookingFor),
				grindrTribes: Array.from(selectedTribes),
			};

			await fetchRest("/v4/me/profile", {
				method: "PATCH",
				body,
			});

			toast.success("Profile updated");
			open = false;
			onSave();
		} catch (err) {
			console.error("Failed to update profile", err);
			const message =
				err instanceof Error ? err.message : "Failed to update profile. Please try again.";
			toast.error(message);
		} finally {
			saving = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] mt-(--safe-area-top) mb-(--safe-area-bottom)"
	>
		<Sheet.Header
			class={[
				"p-4 border border-x-0 border-t-0 border-transparent transition-colors",
				{ "border-muted": contentScroll > 0 },
			]}
		>
			<div class="flex items-center justify-between">
				<Sheet.Title>Edit Profile</Sheet.Title>
				<Sheet.Close>
					{#snippet child({ props })}
						<Button variant="ghost" size="sm" {...props}>Cancel</Button>
					{/snippet}
				</Sheet.Close>
			</div>
		</Sheet.Header>

		<div
			class="flex flex-col gap-5 px-4 py-4 overflow-auto flex-1 min-h-0"
			onscroll={(event) => {
				if (event.target instanceof HTMLDivElement) {
					contentScroll =
						event.target.scrollTop /
						(event.target.scrollHeight - event.target.clientHeight);
				}
			}}
		>
			<!-- Display name -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-display-name">Display name</Label>
				<Input
					id="edit-display-name"
					type="text"
					maxlength={64}
					placeholder="Your name"
					bind:value={displayName}
				/>
			</div>

			<!-- About me -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-about-me">About me</Label>
				<Textarea
					id="edit-about-me"
					maxlength={255}
					placeholder="Tell others about yourself"
					bind:value={aboutMe}
				/>
			</div>

			<!-- Sexual position -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-sexual-position">Sexual position</Label>
				<select
					id="edit-sexual-position"
					bind:value={sexualPosition}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(sexualPositions) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Body type -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-body-type">Body type</Label>
				<select
					id="edit-body-type"
					bind:value={bodyType}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(bodyTypes) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Height -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-height">Height (cm)</Label>
				<Input
					id="edit-height"
					type="number"
					min={100}
					max={250}
					placeholder="e.g. 178"
					bind:value={height}
				/>
			</div>

			<!-- Weight -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-weight">Weight (kg)</Label>
				<Input
					id="edit-weight"
					type="number"
					min={30}
					max={200}
					placeholder="e.g. 75"
					bind:value={weight}
				/>
			</div>

			<!-- Ethnicity -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-ethnicity">Ethnicity</Label>
				<select
					id="edit-ethnicity"
					bind:value={ethnicity}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(ethnicities) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Relationship status -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-relationship-status">Relationship status</Label>
				<select
					id="edit-relationship-status"
					bind:value={relationshipStatus}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(relationshipStatuses) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Looking for -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Looking for</span>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(lookingForLabels) as [id, label]}
						{@const numId = Number(id) as LookingForId}
						{@const isChecked = selectedLookingFor.has(numId)}
						<button
							type="button"
							onclick={() => toggleLookingFor(numId)}
							class={[
								"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
								isChecked
									? "bg-primary text-primary-foreground border-primary"
									: "border-border bg-background text-foreground hover:bg-muted",
							]}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Tribes -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Tribes</span>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(tribeLabels) as [id, label]}
						{@const numId = Number(id) as TribeId}
						{@const isChecked = selectedTribes.has(numId)}
						<button
							type="button"
							onclick={() => toggleTribe(numId)}
							class={[
								"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
								isChecked
									? "bg-primary text-primary-foreground border-primary"
									: "border-border bg-background text-foreground hover:bg-muted",
							]}
						>
							{label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<Sheet.Footer
			class={[
				"p-4 border border-x-0 border-b-0 border-transparent transition-colors",
				{ "border-muted": contentScroll < 1 },
			]}
		>
			<Button type="button" disabled={saving} onclick={() => handleSave()}>
				{saving ? "Saving…" : "Save"}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
