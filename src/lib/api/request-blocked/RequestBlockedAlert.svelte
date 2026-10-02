<script lang="ts">
	import { toast } from "svelte-sonner";

	import { callMethod } from "$lib/api";
	import { requestBlockedAlertState } from "$lib/api/request-blocked/request-blocked-state.svelte";
	import * as AlertDialog from "$lib/components/ui/alert-dialog";
	import { Checkbox } from "$lib/components/ui/checkbox";
	import { Label } from "$lib/components/ui/label";

	let submitting = $state(false);
</script>

<AlertDialog.Root bind:open={requestBlockedAlertState.open}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Grindr blocks your requests</AlertDialog.Title>
			<AlertDialog.Description>
				Cloudflare protecting Grindr API is currently blocking your requests
				because of suspicious activity. If you use a VPN, try disabling it. You
				can also collect the request parameters this app is sending, which is
				the first thing needed to diagnose a block.
				<div class="flex items-center gap-3 text-left mt-4">
					<Checkbox
						id="disable-request-blocked-alert"
						bind:checked={requestBlockedAlertState.disable}
					/>
					<Label for="disable-request-blocked-alert" class="leading-5">
						Don't show again in this session</Label
					>
				</div>
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={submitting}>Close</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={async () => {
					submitting = true;
					try {
						const oldHeaders = await callMethod("rotate_api_params");
						toast.success(
							"If you'd like to help investigate the issue, click 'Copy' and send this information to the developers.",
							{
								id: "rotate-api-params-success",
								action: {
									label: "Copy",
									onClick: async () => {
										// Await the write BEFORE dismissing the toast that owns
										// this action. The previous version kicked the write off
										// with `void …` and dismissed immediately, so a
										// clipboard failure (plugin missing, no permission)
										// rejected into an unhandled promise and the user saw a
										// "Copy" button that silently did nothing.
										try {
											const clipboard =
												await import("@tauri-apps/plugin-clipboard-manager");
											await clipboard.writeText(
												"Failed request parameters:\n" +
													JSON.stringify(oldHeaders, null, 2),
											);
											toast.dismiss("rotate-api-params-success");
											toast.success("Copied to clipboard");
										} catch (clipboardError) {
											console.error(
												"[GrindrX] Failed to copy diagnostic parameters",
												clipboardError,
											);
											toast.error(
												"Couldn't copy — long-press the message and copy manually.",
											);
										}
									},
								},
							},
						);
					} catch (error) {
						console.error(error);
						toast.error("Failed to collect request parameters.");
					} finally {
						submitting = false;
						requestBlockedAlertState.open = false;
					}
				}}
				disabled={submitting}
			>
				Collect diagnostic parameters
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
