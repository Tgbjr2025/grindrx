<script lang="ts">
	import { writeText } from "@tauri-apps/plugin-clipboard-manager";
	import { CaretRightIcon, ShareNetworkIcon } from "phosphor-svelte";
	import { toast } from "svelte-sonner";

	import * as Item from "$lib/components/ui/item";

	// Where a friend lands to get the app.
	const INVITE_URL = "https://github.com/Tgbjr2025/grindrx/releases/latest";
	const SHARE_TEXT =
		"Check out GrindrX — a privacy-focused Grindr client for Android. Get it here:";

	type ShareCapableNavigator = Navigator & {
		share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
	};

	async function share() {
		// Prefer the OS share sheet so the user picks ANY method (messages, email,
		// social, etc.). Fall back to copying the invite link if the WebView doesn't
		// implement navigator.share.
		const nav = navigator as ShareCapableNavigator;
		if (typeof nav.share === "function") {
			try {
				await nav.share({ title: "GrindrX", text: SHARE_TEXT, url: INVITE_URL });
				return;
			} catch (err) {
				// User cancelled the sheet — done, no fallback.
				if (err instanceof DOMException && err.name === "AbortError") return;
				// Any other failure: fall through to clipboard.
			}
		}
		try {
			await writeText(`${SHARE_TEXT} ${INVITE_URL}`);
			toast.success("Invite link copied — paste it to a friend anywhere");
		} catch {
			toast.error("Couldn't open share options");
		}
	}
</script>

<Item.Root variant="outline">
	{#snippet child({ props })}
		<button type="button" {...props} onclick={share}>
			<Item.Media>
				<ShareNetworkIcon class="size-5" weight="fill" />
			</Item.Media>
			<Item.Content class="max-xxxxs:min-w-0">
				<Item.Title>Share GrindrX with a friend</Item.Title>
				<Item.Description>Send an invite link by any app you like.</Item.Description>
			</Item.Content>
			<Item.Actions class="min-w-0">
				<CaretRightIcon class="size-4 shrink-0" />
			</Item.Actions>
		</button>
	{/snippet}
</Item.Root>
