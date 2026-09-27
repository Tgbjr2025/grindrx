<script lang="ts">
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";

	import { ApiHttpError, fetchRest } from "$lib/api";
	import { getGenders } from "$lib/api/genders";
	import { fetchPronouns } from "$lib/api/pronouns";
	import { getDistanceUnit } from "$lib/app-data/distance-unit.svelte";
	import Button from "$lib/components/ui/button/button.svelte";
	import Input from "$lib/components/ui/input/input.svelte";
	import Label from "$lib/components/ui/label/label.svelte";
	import * as Sheet from "$lib/components/ui/sheet";
	import Textarea from "$lib/components/ui/textarea/textarea.svelte";
	import {
		type AcceptNSFWPicsId,
		acceptNSFWPics as acceptNsfwPicsLabels,
		type BodyTypeId,
		bodyTypes,
		ethnicities,
		type EthnicityId,
		type HealthPracticeId,
		healthPractices,
		hivStatuses,
		type HivStatusId,
		type LookingForId,
		lookingFor as lookingForLabels,
		type MeetAtId,
		meetAt as meetAtLabels,
		relationshipStatuses,
		type RelationshipStatusId,
		type SexualPositionId,
		sexualPositions,
		type TribeId,
		tribes as tribeLabels,
		type VaccineId,
		vaccines as vaccineLabels,
	} from "$lib/model/profile";
	import {
		heightFromInput,
		heightToInput,
		heightUnitLabel,
		weightFromInput,
		weightToInput,
		weightUnitLabel,
	} from "$lib/utils/measurements";
	import type { DistanceUnit } from "$lib/utils/distance";

	let {
		open = $bindable(false),
		profileData,
		onSave,
	}: {
		open: boolean;
		profileData: {
			// Every field is `| undefined`-able: `profileSchema` was made tolerant
			// (see D7 in $lib/model/profile), so a profile that never set a field
			// genuinely lacks the key rather than carrying null.
			displayName: string | null | undefined;
			aboutMe: string | null | undefined;
			sexualPosition: SexualPositionId | null | undefined;
			bodyType: BodyTypeId | null | undefined;
			height: number | null | undefined;
			weight: number | null | undefined;
			ethnicity: EthnicityId | null | undefined;
			relationshipStatus: RelationshipStatusId | null | undefined;
			lookingFor: LookingForId[] | undefined;
			grindrTribes: TribeId[] | undefined;
			hivStatus: HivStatusId | null | undefined;
			sexualHealth: HealthPracticeId[] | undefined;
			meetAt: MeetAtId[] | undefined;
			nsfw: AcceptNSFWPicsId | null | undefined;
			vaccines: VaccineId[] | undefined;
			socialNetworks: {
				twitter?: { userId: string | null };
				facebook?: { userId: string | null };
				instagram?: { userId: string | null };
			};
			genders: number[] | undefined;
			pronouns: number[] | undefined;
		};
		onSave: () => void;
	} = $props();

	// Load async data at module level (cached)
	const gendersList = getGenders();
	const pronounsList = fetchPronouns();

	// A NEVER-REJECTING mirror of the two lists.
	//
	// Svelte 5's `{#await}` rethrows when a branch has no `:catch`
	// (`node_modules/svelte/src/internal/client/dom/blocks/await.js`:
	// `if (!catch_fn) { throw error.v; }`), so a failed `getGenders()` used to
	// surface as an unhandled rejection. These mirrors attach a rejection handler
	// to the SAME promise at construction time, so the rejection is always
	// handled no matter when the template subscribes (SSR included), and they
	// give `handleSave` a synchronous answer to "did this list actually load?".
	const settled = <T>(p: Promise<T>) =>
		p.then(
			() => true,
			() => false,
		);
	const gendersSettled = settled(gendersList);
	const pronounsSettled = settled(pronounsList);

	let gendersOk = $state(false);
	let pronounsOk = $state(false);
	$effect(() => {
		let alive = true;
		void gendersSettled.then((ok) => alive && (gendersOk = ok));
		void pronounsSettled.then((ok) => alive && (pronounsOk = ok));
		return () => {
			alive = false;
		};
	});

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

	// Form state — initialised to NEUTRAL values, never from `profileData`.
	//
	// D5: this used to be `useState(profileData.x ?? default)` for ~30 fields.
	// The parent passes `profileData={{ ... }}` as a FRESH object literal on every
	// render, so the prop signal changed on every parent re-render, and the
	// "reset the form when the sheet opens" effect below re-ran — while `open` was
	// still true — and reassigned all 25 fields from the server snapshot,
	// discarding whatever the user had typed. Reading props in a `$state`
	// initialiser is also what produced the 26 `state_referenced_locally`
	// warnings svelte-check reports for this file: a `$state` initialiser is
	// evaluated once, outside any effect, so it is not allowed to read reactive
	// values. Initialising neutrally and filling from ONE effect on the open
	// TRANSITION fixes the data loss and the warnings together.
	let displayName = $state("");
	let aboutMe = $state("");
	let sexualPosition = $state<SexualPositionId | "">("");
	let bodyType = $state<BodyTypeId | "">("");
	// isImperialHeight is $derived (not read once into a $state initializer) so
	// the feet/inches vs. cm branch below stays in sync with the live unit.
	let isImperialHeight = $derived(heightUnitLabel(getDistanceUnit()) === "in");
	let height = $state("");
	let heightFeet = $state("");
	let heightInches = $state("");
	let weight = $state("");
	let ethnicity = $state<EthnicityId | "">("");
	let relationshipStatus = $state<RelationshipStatusId | "">("");
	let selectedLookingFor = $state<Set<LookingForId>>(new Set());
	let selectedTribes = $state<Set<TribeId>>(new Set());
	let hivStatus = $state<HivStatusId | "">("");
	let selectedHealthPractices = $state<Set<HealthPracticeId>>(new Set());
	let selectedMeetAt = $state<Set<MeetAtId>>(new Set());
	let nsfwPics = $state<AcceptNSFWPicsId | "">("");
	let selectedVaccines = $state<Set<VaccineId>>(new Set());
	let instagram = $state("");
	let twitter = $state("");
	let facebook = $state("");
	let selectedGenders = $state<Set<number>>(new Set());
	let selectedPronouns = $state<Set<number>>(new Set());

	let saving = $state(false);
	// Two booleans rather than a 0..1 ratio: see the `onscroll` handler.
	let canScrollUp = $state(false);
	let canScrollDown = $state(false);

	// D3: until BOTH reference lists have settled, the chip groups cannot render
	// and Save must not send the pre-load `selectedGenders`/`selectedPronouns`
	// (which is what silently wiped a user's gender). `gendersOk`/`pronounsOk`
	// above track the settled state, including failure.
	const listsPending = $derived(!gendersOk || !pronounsOk);

	/**
	 * Copy the server snapshot into the form. Called exactly once per OPEN
	 * TRANSITION (see the effect below), never on an arbitrary re-render.
	 */
	function syncFromProfile() {
		const unit = getDistanceUnit();
		displayName = profileData.displayName ?? "";
		aboutMe = profileData.aboutMe ?? "";
		sexualPosition = profileData.sexualPosition ?? "";
		bodyType = profileData.bodyType ?? "";
		// D7 made `height`/`weight` `.optional()` in `profileSchema`, so a profile
		// that never set them arrives as `undefined`, not just `null`. Bind to
		// locals so the narrowing is visible to the type-checker on every use below.
		const profileHeight = profileData.height ?? null;
		const profileWeight = profileData.weight ?? null;
		height = profileHeight != null ? String(heightToInput(profileHeight, unit)) : "";
		const feetInches = feetInchesFromCm(profileHeight, unit);
		heightFeet = feetInches.feet;
		heightInches = feetInches.inches;
		weight = profileWeight != null ? String(weightToInput(profileWeight, unit)) : "";
		ethnicity = profileData.ethnicity ?? "";
		relationshipStatus = profileData.relationshipStatus ?? "";
		selectedLookingFor = new Set(profileData.lookingFor ?? []);
		selectedTribes = new Set(profileData.grindrTribes ?? []);
		hivStatus = profileData.hivStatus ?? "";
		selectedHealthPractices = new Set(profileData.sexualHealth ?? []);
		selectedMeetAt = new Set(profileData.meetAt ?? []);
		nsfwPics = profileData.nsfw ?? "";
		selectedVaccines = new Set(profileData.vaccines ?? []);
		instagram = profileData.socialNetworks?.instagram?.userId ?? "";
		twitter = profileData.socialNetworks?.twitter?.userId ?? "";
		facebook = profileData.socialNetworks?.facebook?.userId ?? "";
		selectedGenders = new Set(profileData.genders ?? []);
		selectedPronouns = new Set(profileData.pronouns ?? []);
		dirty = false;
	}

	// The values the form had when it was opened, for the unsaved-changes guard.
	// A JSON snapshot rather than a deep-compare: it is one allocation per open
	// and cannot drift out of sync with the field list.
	let pristineSnapshot = $state("");

	function formSnapshot(): string {
		return JSON.stringify({
			displayName,
			aboutMe,
			sexualPosition,
			bodyType,
			height,
			heightFeet,
			heightInches,
			weight,
			ethnicity,
			relationshipStatus,
			lookingFor: [...selectedLookingFor],
			tribes: [...selectedTribes],
			hivStatus,
			healthPractices: [...selectedHealthPractices],
			meetAt: [...selectedMeetAt],
			nsfwPics,
			vaccines: [...selectedVaccines],
			instagram,
			twitter,
			facebook,
			genders: [...selectedGenders],
			pronouns: [...selectedPronouns],
		});
	}

	// D6: bits-ui's Dialog dismisses on Escape and outside pointer-down by
	// default, and the Cancel button discards everything — so one stray tap
	// outside the sheet destroyed 20+ fields of work with no prompt. `dirty`
	// turns that into a question.
	let dirty = $state(false);
	let confirmDiscardOpen = $state(false);

	/**
	 * Reset the form on the OPEN TRANSITION only.
	 *
	 * Reading `open` and comparing against the previous value inside one effect
	 * means the reset is a function of the transition, not of "is currently open":
	 * a parent re-render (which recreates the `profileData` object literal) can
	 * no longer trigger it while the sheet is open.
	 */
	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) syncFromProfile();
		wasOpen = isOpen;
	});

	// `dirty` tracks the form against the snapshot taken on open.
	$effect(() => {
		// Depend on every field so the comparison re-runs as the user types.
		void displayName;
		void aboutMe;
		void sexualPosition;
		void bodyType;
		void height;
		void heightFeet;
		void heightInches;
		void weight;
		void ethnicity;
		void relationshipStatus;
		void selectedLookingFor;
		void selectedTribes;
		void hivStatus;
		void selectedHealthPractices;
		void selectedMeetAt;
		void nsfwPics;
		void selectedVaccines;
		void instagram;
		void twitter;
		void facebook;
		void selectedGenders;
		void selectedPronouns;
		if (!open) return;
		dirty = formSnapshot() !== pristineSnapshot;
	});

	// Keep the pristine snapshot in step with the values `syncFromProfile` wrote,
	// without reading the fields (which would re-trigger the dirty effect).
	$effect(() => {
		if (open) untrack(() => (pristineSnapshot = formSnapshot()));
	});

	/**
	 * Guard a close while the form is dirty.
	 *
	 * `Dialog.Root`'s `onOpenChange` receives the NEXT VALUE, not an event, so it
	 * cannot be `preventDefault()`-ed — by the time it runs, `open` is already
	 * false. The close is therefore undone (`open = true`) and a confirm is
	 * offered. Escape and outside pointer-down never get this far: they are
	 * prevented at `Sheet.Content` and raise the confirm via
	 * `requestDiscardConfirm` instead.
	 */
	function handleOpenChange(next: boolean) {
		if (!next && dirty && !confirmDiscardOpen) {
			open = true;
			confirmDiscardOpen = true;
		}
	}

	/**
	 * The dismissals that `preventDefault()` swallows (Escape, outside
	 * pointer-down) never reach `handleOpenChange` — bits-ui checks
	 * `defaultPrevented` and skips `root.handleClose()` entirely
	 * (`bits/dialog/components/dialog-content.svelte`: `onInteractOutside(e);
	 * if (e.defaultPrevented) return; handleClose()`). So they have to raise the
	 * confirm themselves, or the user's tap outside does nothing at all with no
	 * explanation — the sheet just refuses to close.
	 */
	function requestDiscardConfirm() {
		if (!dirty) return false;
		confirmDiscardOpen = true;
		return true;
	}

	function closeDiscarding() {
		confirmDiscardOpen = false;
		// Clear `dirty` FIRST: the close below runs through `handleOpenChange`,
		// which would otherwise re-open the sheet we are trying to close.
		dirty = false;
		open = false;
	}

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
	//
	// NOTE: these inputs are `type="number"`, and Svelte coerces number bindings
	// with `to_number`, which returns `null` (not `""`) for an empty field. The
	// previous `heightFeet.trim()` therefore threw a TypeError as soon as the
	// user cleared either box, and `weight !== ""` was true for `null` so
	// clearing weight sent `weight: 0`. Normalise once, here.
	const numText = (value: string | number | null | undefined): string =>
		String(value ?? "").trim();

	function resolveHeightCm(): number | null {
		if (isImperialHeight) {
			const feetStr = numText(heightFeet);
			const inchesStr = numText(heightInches);
			if (feetStr === "" && inchesStr === "") return null;
			const feet = feetStr === "" ? 0 : Number(feetStr);
			const inches = inchesStr === "" ? 0 : Number(inchesStr);
			// A non-finite value (e.g. "1e999" -> Infinity) would be encoded as a
			// msgpack float that the Tauri bridge refuses to decode, failing the
			// ENTIRE PATCH and silently discarding every other field. Drop it.
			const totalInches = feet * INCHES_PER_FOOT + inches;
			if (!Number.isFinite(totalInches)) return null;
			return heightFromInput(totalInches, getDistanceUnit());
		}
		const cmStr = numText(height);
		if (cmStr === "") return null;
		const cm = Number(cmStr);
		if (!Number.isFinite(cm)) return null;
		return heightFromInput(cm, getDistanceUnit());
	}

	/** `null` for an empty/invalid field, else the converted value. */
	function resolveWeight(): number | null {
		const raw = numText(weight);
		if (raw === "") return null;
		const value = weightFromInput(Number(raw), getDistanceUnit());
		return Number.isFinite(value) ? value : null;
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
				weight: resolveWeight(),
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
			};

			// D3 — DATA LOSS. These two blocks used to have no `:catch`, which Svelte
			// 5 converts into a RETHROWN unhandled rejection
			// (`await.js`: `if (!catch_fn) throw error.v`). When the gender/pronoun
			// reference list failed to load, the chip groups vanished, these sets
			// kept their pre-load values, and the unconditional
			// `genders: Array.from(selectedGenders)` WIPED the user's gender
			// selection server-side while still reporting "Profile updated". So:
			// omit the field entirely while its list is unresolved — a PATCH that
			// does not mention a field does not change it. `listsPending` also
			// disables Save, so this is belt-and-braces.
			if (gendersOk) body.genders = Array.from(selectedGenders);
			if (pronounsOk) body.pronouns = Array.from(selectedPronouns);

			// `fetchRest` only rejects on an IPC/bridge failure — an HTTP 4xx/5xx
			// comes back as a normal response. The result was never inspected, so
			// a rejected save showed "Profile updated" and closed the sheet while
			// nothing had changed.
			const res = await fetchRest("/v4/me/profile", {
				method: "PATCH",
				body,
			});
			if (res.status >= 400) {
				throw new ApiHttpError(res.status, res.text(), "/v4/me/profile");
			}

			toast.success("Profile updated");
			// Clear `dirty` before closing: `open = false` routes through
			// `onOpenChange`, and the guard would otherwise re-open the sheet we
			// just successfully saved.
			dirty = false;
			open = false;
			onSave();
		} catch (err) {
			console.error("Failed to update profile", err);
			const message =
				err instanceof ApiHttpError && (err.status === 402 || err.status === 403)
					? "Grindr rejected that change. Some profile fields require a Grindr XTRA subscription."
					: err instanceof Error
						? err.message
						: "Failed to update profile. Please try again.";
			toast.error(message);
		} finally {
			saving = false;
		}
	}
</script>

<!--
	D6: `onOpenChange` is the catch-all close path (the Cancel button, and any
	close bits-ui routes through the box setter). Escape and outside
	pointer-down are intercepted earlier at `Sheet.Content`, so they are
	prevented there and raise the same confirm — see `requestDiscardConfirm`.
-->
<Sheet.Root bind:open onOpenChange={handleOpenChange}>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] mt-(--safe-area-top) mb-(--safe-area-bottom)"
		onEscapeKeydown={(event: KeyboardEvent) => {
			// Dirty: swallow the dismiss rather than lose 20+ fields, and ask
			// instead of silently refusing.
			if (requestDiscardConfirm()) event.preventDefault();
		}}
		onInteractOutside={(event: PointerEvent) => {
			if (requestDiscardConfirm()) event.preventDefault();
		}}
		onFocusOutside={(event: FocusEvent) => {
			// The confirm renders OUTSIDE the sheet, so focusing it lands here.
			// bits-ui only ever closes from escape/pointer, so this cannot block a
			// close either way; kept conditional so focus is never trapped if a
			// future bits-ui version starts honouring `defaultPrevented` here.
			if (dirty) event.preventDefault();
		}}
	>
		<Sheet.Header
			class={[
				"p-4 border border-x-0 border-t-0 border-transparent transition-colors",
				// Scroll border: the header border appears once you are PAST the top
				// (it was inverted before). `canScrollUp` is guarded against a
				// non-scrollable container, where the ratio is 0/0 = NaN and every
				// `NaN < x` comparison is false — which made both borders vanish.
				{ "border-muted": canScrollUp },
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
					const range = event.target.scrollHeight - event.target.clientHeight;
					// `range === 0` (nothing to scroll) would make this 0/0 = NaN.
					// A separate boolean pair avoids relying on `NaN` comparisons,
					// which are always false and silently hid both scroll borders.
					canScrollDown = range > 0 && event.target.scrollTop < range;
					canScrollUp = range > 0 && event.target.scrollTop > 0;
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

			<!--
				Genders / Pronouns.

				D20: each group is a `<fieldset>` with a `<legend>` (not a bare
				`<span>`), and every chip carries `aria-pressed` — selection was
				conveyed by colour alone, so a screen-reader user had no way to
				tell a selected chip from an unselected one.

				D3: the `{#await}` blocks now have a `:catch`. Without one Svelte 5
				RETHROWS the rejection (see `await.js`: `if (!catch_fn) throw
				error.v`), which both surfaced as an unhandled rejection and made
				the group vanish while `handleSave` still sent the pre-load
				selection — wiping the user's gender server-side. `listsPending`
				additionally disables Save until both lists resolve.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Gender</legend>
				{#await gendersList}
					<p class="text-sm text-muted-foreground">Loading…</p>
				{:then allGenders}
					<div class="flex flex-wrap gap-2">
						{#each allGenders.filter((g) => !g.excludeOnProfileSelection?.length) as g (g.genderId)}
							{@const isChecked = selectedGenders.has(g.genderId)}
							<button
								type="button"
								aria-pressed={isChecked}
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
				{:catch}
					<p class="text-sm text-destructive">
						Couldn't load gender options. Saving will leave your current
						gender untouched.
					</p>
				{/await}
			</fieldset>

			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Pronouns</legend>
				{#await pronounsList}
					<p class="text-sm text-muted-foreground">Loading…</p>
				{:then allPronouns}
					<div class="flex flex-wrap gap-2">
						{#each allPronouns as p (p.pronounId)}
							{@const isChecked = selectedPronouns.has(p.pronounId)}
							<button
								type="button"
								aria-pressed={isChecked}
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
				{:catch}
					<p class="text-sm text-destructive">
						Couldn't load pronoun options. Saving will leave your current
						pronouns untouched.
					</p>
				{/await}
			</fieldset>

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

			<!--
				Looking for: D20 — `<fieldset>`/`<legend>` instead of a bare `<span>`, a
				KEYED each (so re-ordering the options cannot make Svelte reuse the
				wrong chip), and `aria-pressed` so selection is not colour-only.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Looking for</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(lookingForLabels) as [id, label] (id)}
						{@const numId = Number(id) as LookingForId}
						{@const isChecked = selectedLookingFor.has(numId)}
						<button
							type="button"
							aria-pressed={isChecked}
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
			</fieldset>

			<!--
				Tribes: D20 — `<fieldset>`/`<legend>` instead of a bare `<span>`, a
				KEYED each (so re-ordering the options cannot make Svelte reuse the
				wrong chip), and `aria-pressed` so selection is not colour-only.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Tribes</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(tribeLabels) as [id, label] (id)}
						{@const numId = Number(id) as TribeId}
						{@const isChecked = selectedTribes.has(numId)}
						<button
							type="button"
							aria-pressed={isChecked}
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
			</fieldset>

			<!--
				Meet at: D20 — `<fieldset>`/`<legend>` instead of a bare `<span>`, a
				KEYED each (so re-ordering the options cannot make Svelte reuse the
				wrong chip), and `aria-pressed` so selection is not colour-only.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Meet at</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(meetAtLabels) as [id, label] (id)}
						{@const numId = Number(id) as MeetAtId}
						{@const isChecked = selectedMeetAt.has(numId)}
						<button
							type="button"
							aria-pressed={isChecked}
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
			</fieldset>

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

			<!--
				Health practices: D20 — `<fieldset>`/`<legend>` instead of a bare `<span>`, a
				KEYED each (so re-ordering the options cannot make Svelte reuse the
				wrong chip), and `aria-pressed` so selection is not colour-only.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Health practices</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(healthPractices) as [id, label] (id)}
						{@const numId = Number(id) as HealthPracticeId}
						{@const isChecked = selectedHealthPractices.has(numId)}
						<button
							type="button"
							aria-pressed={isChecked}
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
			</fieldset>

			<!--
				Vaccines: D20 — `<fieldset>`/`<legend>` instead of a bare `<span>`, a
				KEYED each (so re-ordering the options cannot make Svelte reuse the
				wrong chip), and `aria-pressed` so selection is not colour-only.
			-->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium leading-none">Vaccines</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(vaccineLabels) as [id, label] (id)}
						{@const numId = Number(id) as VaccineId}
						{@const isChecked = selectedVaccines.has(numId)}
						<button
							type="button"
							aria-pressed={isChecked}
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
			</fieldset>

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
				{ "border-muted": canScrollDown },
			]}
		>
			<Button
				type="button"
				disabled={saving || listsPending}
				onclick={() => handleSave()}
			>
				{saving ? "Saving…" : "Save"}
			</Button>
			{#if listsPending}
				<p class="text-xs text-muted-foreground text-center mt-2">
					Still loading your gender and pronoun options — saving now would
					overwrite them.
				</p>
			{/if}
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>

<!--
	Unsaved-changes confirm (D6). Reuses the hand-rolled `role="alertdialog"`
	pattern from settings → account → photos, rather than nesting a second modal
	Dialog inside the Sheet, which fights bits-ui's focus trap.
-->
{#if confirmDiscardOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-6"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="discard-title"
	>
		<button
			type="button"
			aria-label="Keep editing"
			class="absolute inset-0 bg-black/60"
			onclick={() => (confirmDiscardOpen = false)}
		></button>
		<div
			class="relative w-full max-w-80 rounded-2xl border border-border bg-popover p-5 flex flex-col gap-4"
		>
			<div class="flex flex-col gap-1.5">
				<p id="discard-title" class="font-semibold">Discard your changes?</p>
				<p class="text-sm text-muted-foreground">
					You have edits that haven't been saved yet.
				</p>
			</div>
			<div class="flex gap-2 justify-end">
				<Button variant="ghost" size="sm" onclick={() => (confirmDiscardOpen = false)}>
					Keep editing
				</Button>
				<Button
					size="sm"
					class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					onclick={() => closeDiscarding()}
				>
					Discard
				</Button>
			</div>
		</div>
	</div>
{/if}
