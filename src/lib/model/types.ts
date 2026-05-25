import z from "zod";

export const unixTimestampMsSchema = z.number().nonnegative();
