import z from "zod";

export const unixTimestampMsSchema = z.number().int().positive();
