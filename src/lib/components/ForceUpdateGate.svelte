<script lang="ts">
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DownloadSimpleIcon, WarningIcon } from "phosphor-svelte";
import { onMount } from "svelte";

import { openExternalUrl } from "$lib/api/open-url";
import {
	evaluateUpdate,
	type UpdateCheck,
} from "$lib/update-gate.svelte";

let check = $state<UpdateCheck>({ state: "unavailable", reason: "Checking…" });
let opening = $state(false);
let copyNote = $state<string | null>(null);

/**
 * Blocking update gate.
 *
 * v0.1.33 shipped a PIN migration bug that permanently locked out anyone who had
 * set an app-lock PIN in v0.1.25-v0.1.32, with no recovery path. v0.1.34 fixes
 * it, so a user below the minimum cannot proceed — there is nothing they can do
 * from inside the broken app.
 *
 * Deliberate design rules:
 * - It NEVER blocks on a network or parse failure. Locking someone out of a
 *   working app because a server was briefly unreachable would be far worse than
 *   letting them through.
 * - There is always a second way out. The Download button goes through
 *   `openExternalUrl` (the plugin's own `openUrl` is broken on Android), and
 *   "Copy link" is offered alongside it. A mandatory gate whose only action is a
 *   single button is one bad button away from bricking the app.
 * - No dismiss control. That is the point of it.
 */
onMount(async () => {
	try {
		const [current, body] = await Promise.all([
			getVersion(),
			invoke<string>("fetch_latest_release"),
		]);
		const release = JSON.parse(body) as {
			tag_name?: string;
			html_url?: string;
			body?: string;
			draft?: boolean;
			prerelease?: boolean;
		};
		// A draft or prerelease must never be what a user is pushed onto.
		if (release.draft || release.prerelease) {
			check = { state: "unavailable", reason: "No stable release found." };
			return;
		}
		check = evaluateUpdate({
			currentVersion: current,
			latestTag: release.tag_name ?? null,
			releaseUrl: release.html_url ?? null,
			releaseNotes: release.body ?? null,
		});
	} catch (e) {
		check = {
			state: "unavailable",
			reason: e instanceof Error ? e.message : "Update check failed.",
		};
	}
});

async function download() {
	if (check.state !== "required") return;
	opening = true;
	const result = await openExternalUrl(check.releaseUrl);
	opening = false;
	if (!result.opened) {
		// Say so. A button that silently fails is what started this.
		copyNote = result.error ?? "Could not open the link — use Copy link instead.";
		return;
	}
	copyNote = null;
}

async function copyLink() {
	if (check.state !== "required") return;
	try {
		await writeText(check.releaseUrl);
		copyNote = "Link copied. Open it in a browser to download.";
	} catch {
		copyNote = `Could not copy. The link is: ${check.releaseUrl}`;
	}
}
</script>

{#if check.state === "required"}
	<!--
		Rendered above everything, with the highest z-index in the app, and
		non-dismissable. Covers the whole viewport so nothing behind it is
		reachable or tappable.
	-->
	<div
		class="fixed inset-0 z-[100000000] flex flex-col bg-background text-foreground"
		role="alertdialog"
		aria-modal="true"
		aria-labelledby="force-update-title"
	>
		<div class="flex-1 overflow-y-auto px-6 py-10 sm:mx-auto sm:max-w-lg sm:w-full">
			<div class="flex items-center gap-2 text-destructive">
				<WarningIcon class="size-6 shrink-0" weight="fill" />
				<h1 id="force-update-title" class="text-lg font-semibold">
					Update required
				</h1>
			</div>

			<p class="mt-4 text-sm leading-relaxed">
				You are on <span class="font-mono">{check.currentVersion}</span>. This
				version
				<span class="font-semibold">cannot be used safely</span> — a bug in it
				locked people out of their own app, and there is no way to recover from
				inside it. You need at least
				<span class="font-mono">{check.requiredVersion}</span>.
			</p>

			<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
				Your photos, messages and settings are untouched and still on your
				phone. Updating restores access. Nothing is deleted.
			</p>

			{#if check.releaseNotes}
				<div class="mt-6">
					<h2 class="text-sm font-semibold">What changed</h2>
					<div
						class="mt-2 max-h-64 overflow-y-auto rounded-lg bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words"
					>
						{check.releaseNotes}
					</div>
				</div>
			{/if}

			<div class="mt-8 flex flex-col gap-2">
				<button
					type="button"
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
					disabled={opening}
					onclick={download}
				>
					<DownloadSimpleIcon class="size-4" />
					{opening ? "Opening…" : `Download ${check.latestVersion}`}
				</button>

				<button
					type="button"
					class="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
					onclick={copyLink}
				>
					Copy download link
				</button>
			</div>

			{#if copyNote}
				<p class="mt-3 text-center text-xs text-muted-foreground" role="status">
					{copyNote}
				</p>
			{/if}
		</div>
	</div>
{/if}
