<script lang="ts">
	import { TagIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import { ApiHttpError, fetchRest } from "$lib/api";
	import { getProfileTags } from "$lib/api/tags";
	import Button from "$lib/components/ui/button/button.svelte";
	import * as Empty from "$lib/components/ui/empty";
	import * as Sheet from "$lib/components/ui/sheet";
	import { Spinner } from "$lib/components/ui/spinner";
	import {
		loadFailed,
		loadStarted,
		loadSucceeded,
		planSave,
		saveFinished,
		saveStarted,
		tagsStateInit,
		toggleTag,
	} from "$lib/profile-tags/tags-state";

	/**
	 * The profile-tag PICKER (WP-7) — the write side of `profileTags`.
	 *
	 * `$lib/api/tags`' `getProfileTags` returns the reference VOCABULARY
	 * (`GET /v1/tags`), not the user's tags. Those already exist as
	 * `profileTags: string[]` on the profile and are rendered read-only by
	 * `ProfileTags.svelte`; this sheet is the only place they can be changed, so
	 * it lives on the user's own profile next to Edit Profile.
	 *
	 * The state machine is `$lib/profile-tags/tags-state` (there is no
	 * component-test runner in this project, so the logic lives where `vitest`
	 * can reach it). This file is a thin shell over it.
	 *
	 * ## Two failure paths, both visible
	 *
	 * 1. **The load fails.** `$lib/api/tags` deliberately does NOT swallow a
	 *    non-array root payload, so a wrong-shaped response REJECTS rather than
	 *    arriving as `[]`. That is the correct contract — an empty tag list is
	 *    indistinguishable from "this account has no tags" — which obliges this
	 *    screen to show the failure instead of rendering an empty picker that
	 *    looks like a working control. Hence the error state AND the toast.
	 * 2. **The save fails.** The sheet STAYS OPEN with the selection intact and
	 *    says so; it does not close and imply success, which is the bug
	 *    `EditProfileSheet` documents at D3.
	 *
	 * Save is gated on `planSave`, which refuses unless the vocabulary loaded.
	 * `PATCH /v4/me/profile` replaces `profileTags` wholesale, so saving from an
	 * unresolved list would delete every tag the user has.
	 */

	let {
		open = $bindable(false),
		/** The profile's current `profileTags`; `undefined` when never set. */
		profileTags,
		onSave,
	}: {
		open: boolean;
		profileTags: string[] | null | undefined;
		onSave: () => void;
	} = $props();

	/** Constant on purpose: a user-facing error never names a profile or a tag id. */
	const LOAD_FAILED_MESSAGE = "Failed to load profile tags.";
	const SAVE_FAILED_MESSAGE = "Failed to save profile tags. Please try again.";

	let state = $state(tagsStateInit());
	const plan = $derived(planSave(state));

	async function load() {
		state = loadStarted(state);
		try {
			const languages = await getProfileTags();
			state = loadSucceeded(state, languages, profileTags ?? []);
		} catch (err) {
			// The raw error is console-only. `ApiHttpError.message` can carry the
			// server's own `message`/`code`, which is not ours to put on screen.
			console.error("Failed to load profile tags", err);
			state = loadFailed(state, LOAD_FAILED_MESSAGE);
			toast.error(LOAD_FAILED_MESSAGE);
		}
	}

	/**
	 * Load on the OPEN TRANSITION only, not on "is currently open".
	 *
	 * The parent re-renders this component whenever the profile resolves and
	 * recreates the `profileTags` prop, so an effect that merely read `open`
	 * would re-fetch on every parent render. Comparing against the previous value
	 * makes the load a function of the transition — the same fix as
	 * `EditProfileSheet`'s `wasOpen`.
	 */
	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) {
			load().catch((err: unknown) => console.error(err));
		}
		wasOpen = isOpen;
	});

	async function save() {
		// Re-derived here as well as in the template: the button is disabled when
		// this is false, but a keyboard activation of a stale render must not be
		// able to issue the PATCH.
		const decided = planSave(state);
		if (!decided.ok) {
			toast.error(decided.message);
			return;
		}
		state = saveStarted(state);
		try {
			const res = await fetchRest("/v4/me/profile", {
				method: "PATCH",
				body: decided.body,
			});
			if (res.status >= 400) {
				// The path carries no identifier, so the message is safe — but the
				// toast below is a CONSTANT regardless, so no server text and no
				// id can reach the user through either path.
				throw new ApiHttpError(res.status, res.text(), "/v4/me/profile");
			}
			toast.success("Profile tags updated");
			state = saveFinished(state);
			open = false;
			onSave();
		} catch (err) {
			console.error("Failed to save profile tags", err);
			state = saveFinished(state);
			// The sheet stays OPEN with the selection intact — closing here would
			// read as a save that worked.
			toast.error(
				err instanceof ApiHttpError && (err.status === 402 || err.status === 403)
					? "Grindr rejected that change. Some profile fields require a Grindr XTRA subscription."
					: SAVE_FAILED_MESSAGE,
			);
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		class="max-h-[calc(100dvh-var(--safe-area-top)-var(--safe-area-bottom))] mt-(--safe-area-top) mb-(--safe-area-bottom)"
	>
		<Sheet.Header>
			<Sheet.Title>Profile tags</Sheet.Title>
			<Sheet.Description>
				Pick the tags that describe you. They appear on your profile.
			</Sheet.Description>
		</Sheet.Header>

		<div class="overflow-y-auto px-4 flex-1">
			{#if state.load === "idle" || state.load === "loading"}
				<div class="flex items-center justify-center py-16">
					<Spinner class="size-8" />
				</div>
			{:else if state.load === "error"}
				<!--
					`$lib/api/tags` refuses to swallow a non-array root payload, so this
					state is reachable on real drift and not only on a network error.
					Rendering the empty picker here would look like a working control
					with no tags in it, which is the outcome the strict schema exists
					to prevent.
				-->
				<div class="flex flex-col items-center justify-center gap-4 py-16">
					<p class="text-destructive text-sm text-center">{state.error}</p>
					<Button variant="outline" onclick={() => load().catch((e) => console.error(e))}>
						Try again
					</Button>
				</div>
			{:else if state.groups.length === 0}
				<Empty.Root>
					<Empty.Header>
						<Empty.Media variant="icon">
							<TagIcon weight="fill" />
						</Empty.Media>
						<Empty.Title>No tags available</Empty.Title>
						<Empty.Description>
							The server returned no tags to choose from. Nothing was changed.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				{#each state.groups as group (group.text)}
					<div class="flex flex-col gap-2 mb-4">
						<span class="uppercase text-[11px] font-semibold tracking-widest text-muted-foreground/70">
							{group.text}
						</span>
						<div class="flex flex-wrap gap-1.5">
							{#each group.tags as tag (tag.tagId)}
								{@const isSelected = state.selected.includes(tag.text)}
								<!--
									A plain `<button>` with the house chip classes, not a `Badge`
									nested inside one: the gender picker in `EditProfileSheet` is
									the established shape for a selectable chip here, and it keeps
									the whole chip one interactive element with one accessible name.
								-->
								<button
									type="button"
									aria-pressed={isSelected}
									onclick={() => {
										state = toggleTag(state, tag.text);
									}}
									class={[
										"cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
										isSelected
											? "bg-primary text-primary-foreground border-primary"
											: "border-border bg-background text-foreground hover:bg-muted",
									]}
								>
									{tag.text}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<Sheet.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button
				disabled={!plan.ok || state.saving}
				onclick={() => save().catch((e) => console.error(e))}
			>
				{state.saving ? "Saving…" : "Save"}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
