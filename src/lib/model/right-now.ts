import z from "zod";

export const rightNowStatusSchema = z
	.enum(["NOT_ACTIVE", "HOSTING", "NOT_HOSTING"])
	.or(z.string());
