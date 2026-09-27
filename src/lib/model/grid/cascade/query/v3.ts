import z from "zod";

import { filterHealthPracticesSchema } from "$lib/components/filters/filters";
import { cascadeQuerySchema } from ".";

export const cascadeV3QuerySchema = z.object({
	...cascadeQuerySchema.shape,
	// `exploreUuid` used to be declared as `z.unknown().optional()`, which accepts
	// literally any value — it validated nothing while reading like a real
	// parameter, and nothing in the app ever set it. It is an unreplaced
	// placeholder, so it is removed rather than left as a trap. (Zod strips
	// unknown keys, so any caller that did set it was sending nothing anyway.)
	sexualHealth: filterHealthPracticesSchema.optional(),
});
