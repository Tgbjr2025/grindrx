<script lang="ts">
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { getGenders } from "$lib/api/genders";
	import { fetchPronouns } from "$lib/api/pronouns";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import * as Sheet from "$lib/components/ui/sheet";
	import Textarea from "$lib/components/ui/textarea/textarea.svelte";
	import type { DistanceUnit } from "$lib/utils/distance";
	import {
		acceptNSFWPics as acceptNsfwPicsLabels,
		type AcceptNSFWPicsId,
		type BodyTypeId,
		bodyTypes,
		ethnicities,
		type EthnicityId,
		healthPractices,
		type HealthPracticeId,
		hivStatuses,
		type HivStatusId,
		type LookingForId,
		lookingFor as lookingForLabels,
		meetAt as meetAtLabels,
		type MeetAtId,
		relationshipStatuses,
		type RelationshipStatusId,
		type SexualPositionId,
		sexualPositions,
		type TribeId,
		tribes as tribeLabels,
		vaccines as vaccineLabels,
		type VaccineId,
	} from "$lib/model/profile";
	import {
		heightFromInput,
		heightToInput,
		heightUnitLabel,
		weightFromInput,
		weightToInput,
		weightUnitLabel,
	} from "$lib/utils/measurements";

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
			hivStatus: HivStatusId | null;
			sexualHealth: HealthPracticeId[];
			meetAt: MeetAtId[];
			nsfw: AcceptNSFWPicsId | null;
			vaccines: VaccineId[];
			socialNetworks: {
				twitter?: { userId: string | null };
				facebook?: { userId: string | null };
				instagram?: { userId: string | null };
			};
			genders: number[];
			pronouns: number[];
		};
		onSave: () => void;
	} = $props();

	// Load async data at module level (cached)
	const gendersList = getGenders();
	const pronounsList = fetchPronouns();

	// Imperial height is edited as two inputs (feet + inches) rather than a
	// single raw total-inches number — the profile itself always *displays*
	// height as ft'in" (formatHeight), so a lone "70" input with no unit
	// context was a usability mismatch. heightToInput/heightFromInput (from
	// $lib/utils/measurements) still own the cm<->inches conversion; this file
	// only splits/combines the resulting total inches into feet + inches.
	const INCHES_PER_FOOT = 12;

	function feetInchesFromCm(
		cm: number | null,
		unit: DistanceUnit,
	): { feet: string; inches: string } {
		if (cm === null) return { feet: "", inches: "" };
		const totalInches = heightToInput(cm, unit);
		return {
			feet: String(Math.floor(totalInches / INCHES_PER_FOOT)),
			inches: String(totalInches % INCHES_PER_FOOT),
		};
	}

	// Form state — initialised each time the sheet opens
	let displayName = $state<string>(profileData.displayName ?? "");
	let aboutMe = $state<string>(profileData.aboutMe ?? "");
	let sexualPosition = $state<SexualPositionId | "">(profileData.sexualPosition ?? "");
	let bodyType = $state<BodyTypeId | "">(profileData.bodyType ?? "");
	// isImperialHeight is $derived (not read once into a $state initializer) so
	// the feet/inches vs. cm branch below stays in sync with the live unit.
	let isImperialHeight = $derived(heightUnitLabel(getDistanceUnit()) === "in");
	let height = $state<string>(
		profileData.height !== null
			? String(heightToInput(profileData.height, getDistanceUnit()))
			: "",
	);
	let heightFeet = $state<string>(feetInchesFromCm(profileData.height, getDistanceUnit()).feet);
	let heightInches = $state<string>(
		feetInchesFromCm(profileData.height, getDistanceUnit()).inches,
	);
	let weight = $state<string>(
		profileData.weight !== null
			? String(weightToInput(profileData.weight, getDistanceUnit()))
			: "",
	);
	let ethnicity = $state<EthnicityId | "">(profileData.ethnicity ?? "");
	let relationshipStatus = $state<RelationshipStatusId | "">(
		profileData.relationshipStatus ?? "",
	);
	let selectedLookingFor = $state<Set<LookingForId>>(new Set(profileData.lookingFor));
	let selectedTribes = $state<Set<TribeId>>(new Set(profileData.grindrTribes));
	let hivStatus = $state<HivStatusId | "">(profileData.hivStatus ?? "");
	let selectedHealthPractices = $state<Set<HealthPracticeId>>(new Set(profileData.sexualHealth));
	let selectedMeetAt = $state<Set<MeetAtId>>(new Set(profileData.meetAt));
	let nsfwPics = $state<AcceptNSFWPicsId | "">(profileData.nsfw ?? "");
	let selectedVaccines = $state<Set<VaccineId>>(new Set(profileData.vaccines));
	let instagram = $state(profileData.socialNetworks?.instagram?.userId ?? "");
	let twitter = $state(profileData.socialNetworks?.twitter?.userId ?? "");
	let facebook = $state(profileData.socialNetworks?.facebook?.userId ?? "");
	let selectedGenders = $state<Set<number>>(new Set(profileData.genders));
	let selectedPronouns = $state<Set<number>>(new Set(profileData.pronouns));

	let saving = $state(false);
	let contentScroll = $state(0);

	// Reset form when the sheet is opened
	$effect(() => {
		if (open) {
			displayName = profileData.displayName ?? "";
			aboutMe = profileData.aboutMe ?? "";
			sexualPosition = profileData.sexualPosition ?? "";
			bodyType = profileData.bodyType ?? "";
			height =
				profileData.height !== null
					? String(heightToInput(profileData.height, getDistanceUnit()))
					: "";
			const feetInches = feetInchesFromCm(profileData.height, getDistanceUnit());
			heightFeet = feetInches.feet;
			heightInches = feetInches.inches;
			weight =
				profileData.weight !== null
					? String(weightToInput(profileData.weight, getDistanceUnit()))
					: "";
			ethnicity = profileData.ethnicity ?? "";
			relationshipStatus = profileData.relationshipStatus ?? "";
			selectedLookingFor = new Set(profileData.lookingFor);
			selectedTribes = new Set(profileData.grindrTribes);
			hivStatus = profileData.hivStatus ?? "";
			selectedHealthPractices = new Set(profileData.sexualHealth);
			selectedMeetAt = new Set(profileData.meetAt);
			nsfwPics = profileData.nsfw ?? "";
			selectedVaccines = new Set(profileData.vaccines);
			instagram = profileData.socialNetworks?.instagram?.userId ?? "";
			twitter = profileData.socialNetworks?.twitter?.userId ?? "";
			facebook = profileData.socialNetworks?.facebook?.userId ?? "";
			selectedGenders = new Set(profileData.genders);
			selectedPronouns = new Set(profileData.pronouns);
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

	function toggleHealthPractice(id: HealthPracticeId) {
		const next = new Set(selectedHealthPractices);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedHealthPractices = next;
	}

	function toggleMeetAt(id: MeetAtId) {
		const next = new Set(selectedMeetAt);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedMeetAt = next;
	}

	function toggleVaccine(id: VaccineId) {
		const next = new Set(selectedVaccines);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedVaccines = next;
	}

	function toggleGender(id: number) {
		const next = new Set(selectedGenders);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedGenders = next;
	}

	function togglePronoun(id: number) {
		const next = new Set(selectedPronouns);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedPronouns = next;
	}

	// Combine the two imperial inputs (or read the single metric one) back into
	// stored centimeters. A feet-only or inches-only entry is treated as the
	// other half being 0 (e.g. "5" ft with inches left blank == 5'0"); both
	// blank clears the height, matching the previous single-input behavior.
	function resolveHeightCm(): number | null {
		if (isImperialHeight) {
			const feetStr = heightFeet.trim();
			const inchesStr = heightInches.trim();
			if (feetStr === "" && inchesStr === "") return null;
			const totalInches =
				(feetStr !== "" ? Number(feetStr) : 0) * INCHES_PER_FOOT +
				(inchesStr !== "" ? Number(inchesStr) : 0);
			return heightFromInput(totalInches, getDistanceUnit());
		}
		return height !== "" ? heightFromInput(Number(height), getDistanceUnit()) : null;
	}

	async function handleSave() {
		saving = true;
		try {
			const body: Record<string, unknown> = {
				displayName: displayName.trim() !== "" ? displayName.trim() : null,
				aboutMe: aboutMe.trim() !== "" ? aboutMe.trim() : null,
				sexualPosition: sexualPosition !== "" ? sexualPosition : null,
				bodyType: bodyType !== "" ? bodyType : null,
				height: resolveHeightCm(),
				weight:
					weight !== "" ? weightFromInput(Number(weight), getDistanceUnit()) : null,
				ethnicity: ethnicity !== "" ? ethnicity : null,
				relationshipStatus: relationshipStatus !== "" ? relationshipStatus : null,
				lookingFor: Array.from(selectedLookingFor),
				grindrTribes: Array.from(selectedTribes),
				hivStatus: hivStatus !== "" ? hivStatus : null,
				sexualHealth: Array.from(selectedHealthPractices),
				meetAt: Array.from(selectedMeetAt),
				nsfw: nsfwPics !== "" ? nsfwPics : null,
				vaccines: Array.from(selectedVaccines),
				socialNetworks: {
					instagram: { userId: instagram.trim() !== "" ? instagram.trim() : null },
					twitter: { userId: twitter.trim() !== "" ? twitter.trim() : null },
					facebook: { userId: facebook.trim() !== "" ? facebook.trim() : null },
				},
				genders: Array.from(selectedGenders),
				pronouns: Array.from(selectedPronouns),
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

			<!-- Genders -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Gender</span>
				{#await gendersList then allGenders}
					<div class="flex flex-wrap gap-2">
						{#each allGenders.filter((g) => !g.excludeOnProfileSelection?.length) as g}
							{@const isChecked = selectedGenders.has(g.genderId)}
							<button
								type="button"
								onclick={() => toggleGender(g.genderId)}
								class={[
									"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
									isChecked
										? "bg-primary text-primary-foreground border-primary"
										: "border-border bg-background text-foreground hover:bg-muted",
								]}
							>
								{g.gender}
							</button>
						{/each}
					</div>
				{/await}
			</div>

			<!-- Pronouns -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Pronouns</span>
				{#await pronounsList then allPronouns}
					<div class="flex flex-wrap gap-2">
						{#each allPronouns as p}
							{@const isChecked = selectedPronouns.has(p.pronounId)}
							<button
								type="button"
								onclick={() => togglePronoun(p.pronounId)}
								class={[
									"rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
									isChecked
										? "bg-primary text-primary-foreground border-primary"
										: "border-border bg-background text-foreground hover:bg-muted",
								]}
							>
								{p.pronoun}
							</button>
						{/each}
					</div>
				{/await}
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
			{#if isImperialHeight}
				<div class="flex flex-col gap-2">
					<span class="text-sm font-medium leading-none">Height</span>
					<div class="flex gap-2">
						<div class="flex-1 flex flex-col gap-1.5">
							<Label for="edit-height-feet" class="text-muted-foreground text-xs font-normal">
								Feet
							</Label>
							<Input
								id="edit-height-feet"
								type="number"
								min="0"
								placeholder="e.g. 5"
								bind:value={heightFeet}
							/>
						</div>
						<div class="flex-1 flex flex-col gap-1.5">
							<Label for="edit-height-inches" class="text-muted-foreground text-xs font-normal">
								Inches
							</Label>
							<Input
								id="edit-height-inches"
								type="number"
								min="0"
								max="11"
								placeholder="e.g. 10"
								bind:value={heightInches}
							/>
						</div>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-1.5">
					<Label for="edit-height">Height (cm)</Label>
					<Input
						id="edit-height"
						type="number"
						placeholder="e.g. 178"
						bind:value={height}
					/>
				</div>
			{/if}

			<!-- Weight -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-weight">Weight ({weightUnitLabel(getDistanceUnit())})</Label>
				<Input
					id="edit-weight"
					type="number"
					placeholder={weightUnitLabel(getDistanceUnit()) === "lbs" ? "e.g. 165" : "e.g. 75"}
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

			<!-- Meet at -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Meet at</span>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(meetAtLabels) as [id, label]}
						{@const numId = Number(id) as MeetAtId}
						{@const isChecked = selectedMeetAt.has(numId)}
						<button
							type="button"
							onclick={() => toggleMeetAt(numId)}
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

			<!-- NSFW pics -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-nsfw">NSFW pics</Label>
				<select
					id="edit-nsfw"
					bind:value={nsfwPics}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(acceptNsfwPicsLabels) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- HIV status -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-hiv-status">HIV status</Label>
				<select
					id="edit-hiv-status"
					bind:value={hivStatus}
					class="bg-input/50 focus-visible:border-ring focus-visible:ring-ring/30 h-9 rounded-3xl border border-transparent px-3 py-1 text-base md:text-sm text-foreground outline-none w-full transition-[color,box-shadow,background-color] focus-visible:ring-3"
				>
					<option value="">Not specified</option>
					{#each Object.entries(hivStatuses) as [id, label]}
						<option value={Number(id)}>{label}</option>
					{/each}
				</select>
			</div>

			<!-- Health practices -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Health practices</span>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(healthPractices) as [id, label]}
						{@const numId = Number(id) as HealthPracticeId}
						{@const isChecked = selectedHealthPractices.has(numId)}
						<button
							type="button"
							onclick={() => toggleHealthPractice(numId)}
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

			<!-- Vaccines -->
			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium leading-none">Vaccines</span>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(vaccineLabels) as [id, label]}
						{@const numId = Number(id) as VaccineId}
						{@const isChecked = selectedVaccines.has(numId)}
						<button
							type="button"
							onclick={() => toggleVaccine(numId)}
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

			<!-- Instagram -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-instagram">Instagram username</Label>
				<Input
					id="edit-instagram"
					type="text"
					maxlength={64}
					placeholder="@yourhandle"
					bind:value={instagram}
				/>
			</div>

			<!-- Twitter/X -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-twitter">Twitter/X username</Label>
				<Input
					id="edit-twitter"
					type="text"
					maxlength={64}
					placeholder="@yourhandle"
					bind:value={twitter}
				/>
			</div>

			<!-- Facebook -->
			<div class="flex flex-col gap-1.5">
				<Label for="edit-facebook">Facebook username</Label>
				<Input
					id="edit-facebook"
					type="text"
					maxlength={64}
					placeholder="Your Facebook name"
					bind:value={facebook}
				/>
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
