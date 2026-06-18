<script lang="ts">
	import {
		getDistanceUnit,
		setDistanceUnit,
	} from "$lib/app-data/distance-unit.svelte";
	import * as Item from "$lib/components/ui/item";
</script>

<Item.Root variant="outline">
	<Item.Content class="max-xxxxs:min-w-0">
		<Item.Title>Measurement units</Item.Title>
		<Item.Description>
			Choose metric (km, cm, kg) or imperial (mi, ft/in, lbs) for distance,
			height and weight.
		</Item.Description>
	</Item.Content>
	<Item.Actions>
		<div class="flex rounded-lg overflow-hidden border border-border text-sm font-medium">
			<button
				type="button"
				class={[
					"px-3 py-1.5 transition-colors",
					getDistanceUnit() === "km"
						? "bg-primary text-primary-foreground"
						: "bg-transparent text-muted-foreground hover:bg-muted",
				]}
				onclick={() => setDistanceUnit("km")}
			>
				Metric
			</button>
			<button
				type="button"
				class={[
					"px-3 py-1.5 transition-colors",
					getDistanceUnit() === "mi"
						? "bg-primary text-primary-foreground"
						: "bg-transparent text-muted-foreground hover:bg-muted",
				]}
				onclick={() => setDistanceUnit("mi")}
			>
				Imperial
			</button>
		</div>
	</Item.Actions>
</Item.Root>
