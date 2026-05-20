import z from "zod";

export const viewSourceEnumSchema = z
	.enum(["DISCOVER", "FOR_YOU", "UNKNOWN"])
	.or(z.string());
