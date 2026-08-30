<script lang="ts">
	import { getVersion } from "@tauri-apps/api/app";
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { onDestroy, onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import { getProfiles } from "$lib/api/profile";
	import FeatureTour from "$lib/components/FeatureTour.svelte";
	import PinLockGate from "$lib/components/PinLockGate.svelte";
	import WhatsNewDialog from "$lib/components/WhatsNewDialog.svelte";
	import {
		isFirstRun,
		isNewVersion,
		markVersionSeen,
	} from "$lib/stores/onboarding.svelte";
	import { chatV1MessageSentEventSchema, ws } from "$lib/ws.svelte";
	import { getOrCreateConversationsState } from "./chat/conversations-context.svelte";

	let { data, children }: import("./$types").LayoutProps = $props();

	const conversations = getOrCreateConversationsState(data.ourProfileId);

	// First-run tour + per-version "What's new" card.
	let tourOpen = $state(false);
	let whatsNewOpen = $state(false);
	let appVersion = $state("");

	onMount(() => {
		void (async () => {
			try {
				const version = await getVersion();
				appVersion = version;
				if (isFirstRun()) {
					tourOpen = true;
					markVersionSeen(version);
				} else if (isNewVersion(version)) {
					whatsNewOpen = true;
					markVersionSeen(version);
				}
			} catch {
				// no tauri app version available (e.g. web preview) — skip onboarding
			}
		})();
	});

	const unlistenPromise = ws.on(
		"chat.v1.message_sent",
		chatV1MessageSentEventSchema,
		(event) => {
			const message = event.payload;

			// Only show for incoming messages
			if (message.senderId === conversations.ourProfileId) return;

			const conversationId = message.conversationId;

			// Don't show if already viewing that conversation
			if (page.url.pathname.includes(`/chat/${conversationId}`)) return;

			// Look up sender name: try conversation list first, then API
			const entry = conversations.entries.find(
				(e) => e.data.conversationId === conversationId,
			);

			const showToast = (senderName: string) => {
				const description =
					message.type === "Text" && typeof message.body === "object" &&
					message.body !== null && "text" in message.body &&
					typeof message.body.text === "string"
						? message.body.text.slice(0, 60)
						: undefined;

				toast(senderName, {
					description,
					action: {
						label: "Open",
						onClick: () => {
							void goto(`/chat/${conversationId}`);
						},
					},
				});
			};

			if (entry) {
				showToast(entry.data.name || "New message");
			} else {
				getProfiles([message.senderId])
					.then((profiles) => {
						const name = profiles[0]?.displayName || "New message";
						showToast(name);
					})
					.catch(() => {
						showToast("New message");
					});
			}
		},
	);

	type DeepLinkWindow = Window & {
		__handleNotificationDeepLink?: (conversationId: string) => void;
		__pendingNotificationDeepLink?: string;
	};

	$effect(() => {
		// Routes a tapped OS notification (set by the native NotificationService /
		// MainActivity) to the right conversation.
		const w = window as DeepLinkWindow;
		const handle = (conversationId: string) => {
			if (!conversationId) return;
			if (page.url.pathname.includes(`/chat/${conversationId}`)) return;
			void goto(`/chat/${conversationId}`);
		};
		w.__handleNotificationDeepLink = handle;
		// Drain a deep-link that arrived before this handler was registered
		// (e.g. cold start from a notification tap).
		if (w.__pendingNotificationDeepLink) {
			handle(w.__pendingNotificationDeepLink);
			w.__pendingNotificationDeepLink = undefined;
		}
		return () => {
			if (w.__handleNotificationDeepLink === handle) {
				w.__handleNotificationDeepLink = undefined;
			}
		};
	});

	onDestroy(() => {
		unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
	});
</script>

{@render children?.()}

<PinLockGate />

<WhatsNewDialog bind:open={whatsNewOpen} version={appVersion} onTour={() => (tourOpen = true)} />
<FeatureTour bind:open={tourOpen} />
