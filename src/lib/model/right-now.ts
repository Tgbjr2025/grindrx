import z from "zod";

// Known values as of writing: "NOT_ACTIVE", "HOSTING", "NOT_HOSTING". Kept as a
// plain string (not `z.enum([...]).or(z.string())`) because the `.or(z.string())`
// widening made the enum branch dead code anyway — every string parsed
// successfully regardless of the enum, so it validated nothing while implying
// it did. Grindr adds new "right now" statuses over time; consumers should
// treat unrecognised values as opaque strings rather than assume this set is
// exhaustive.
export const rightNowStatusSchema = z.string();
