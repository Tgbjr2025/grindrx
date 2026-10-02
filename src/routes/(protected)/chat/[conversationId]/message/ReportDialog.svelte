<script lang="ts">
	import { toast } from "svelte-sonner";

	import { fetchRest } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Spinner } from "$lib/components/ui/spinner";

	const REPORT_REASONS: { id: number; label: string }[] = [
		{ id: 1, label: "Spam or scam" },
		{ id: 2, label: "Harassment or abusive behavior" },
		{ id: 3, label: "Inappropriate content" },
		{ id: 4, label: "Underage user" },
		{ id: 5, label: "Fake profile" },
		{ id: 6, label: "Other" },
	];

	let {
		open = $bindable(),
		profileId,
	}: {
		open: boolean;
		profileId: number;
	} = $props();

	let selectedReasonId: number | null = $state(null);
	let comment = $state("");
	let submitting = $state(false);

	function reset() {
		selectedReasonId = null;
		comment = "";
		submitting = false;
	}

	$effect(() => {
		if (!open) reset();
	});

	async function submit() {
		if (selectedReasonId === null) return;
		submitting = true;
		try {
			// `fetchRest` only rejects on an IPC failure — it never rejects on an
			// HTTP error status. A 400/403/500 used to fall straight into the
			// success path, so the user was told their report went through when
			// the server had refused it. Check the status explicitly, matching
			// `lib/api/conversation.ts` / `lib/api/audio.ts`.
			const res = await fetchRest(`/v4/flags/${profileId}`, {
				method: "POST",
				body: {
					reasonId: selectedReasonId,
					...(comment.trim() ? { comment: comment.trim() } : {}),
				},
			});
			if (res.status >= 400) {
				console.error(
					`[GrindrX] report failed (${res.status}) for profile ${profileId}`,
				);
				toast.error("Failed to submit report");
				return;
			}
			toast.success("Report submitted");
			open = false;
		} catch {
			toast.error("Failed to submit report");
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content preventOverflowTextSelection={false} showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>Report profile</Dialog.Title>
			<Dialog.Description>Help us keep the community safe</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-2 py-2">
			{#each REPORT_REASONS as reason (reason.id)}
				<button
					type="button"
					class={[
						"w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors",
						selectedReasonId === reason.id
							? "bg-primary text-primary-foreground"
							: "bg-muted hover:bg-muted/70",
					]}
					onclick={() => (selectedReasonId = reason.id)}
				>
					{reason.label}
				</button>
			{/each}

			<textarea
				class="mt-2 w-full rounded-lg bg-muted px-3 py-2.5 text-sm resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
				placeholder="Additional info (optional)"
				maxlength={280}
				rows={3}
				bind:value={comment}
			></textarea>
		</div>

		<Dialog.Footer class="flex-col-reverse sm:flex-row gap-2">
			<Button
				variant="outline"
				disabled={submitting}
				onclick={() => (open = false)}
			>
				Cancel
			</Button>
			<Button
				disabled={selectedReasonId === null || submitting}
				onclick={submit}
			>
				{#if submitting}
					<Spinner class="mr-2 size-4" />
				{/if}
				Send report
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
