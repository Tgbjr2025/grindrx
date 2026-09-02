# Touch-up job: deepen crest / compass / banner for legibility

Two G-code files (GRBL/gSender dialect, mm, absolute). They cut ONLY the
Tigers crest detail, the compass rose, and the DAVID banner — nothing else.

**Zeroing: identical to the original carve — XY zero at the front-left
corner of the 400×330 stock, Z zero on the ORIGINAL top face.** If the board
never left the spoilboard, just re-zero Z on an untouched surface spot (the
frame rim is at original height). If it was re-mounted, get the same corner
and orientation back before running.

1. `touchup_1_vbit60.nc` — 60° V-bit. Re-traces every engraved line in the
   three zones down its centerline to 2.3 mm below the local surface (was
   1.3–1.5). The V self-centers in the existing grooves and widens them as it
   deepens. ~22 min, F600, deepest point Z−4.30.
2. `touchup_2_taper16.nc` — 1/16" tapered (flat tip). Deepens the banner face
   around the raised DAVID letters and the shield field around the D and
   tiger head from 1.6 → 3.0 mm, in two passes (−2.3 then −3.0).
   Radius-compensated: it cannot touch the raised letters. ~32 min, F800.

Run order doesn't matter. Both verified by simulation: zero cuts outside the
three zones, Z bounds −4.30 / −3.00.

**Dry-run check before cutting:** with the spindle OFF and Z at safe height,
run the first few lines — the first V-bit move should park over the crest /
banner / compass area, nowhere else. Crest center is at X96 Y98.

Afterwards: dark wax in the deepened lines is what really makes them read.
