# FINAL CUT — Run Sheet

## ⛔ Step 0 — Do NOT run the current touchup_taper16_all.nc
It is sized for a 400×330mm carve; your board was carved smaller — that is
why the machine drove off. The file must be rescaled first (steps 1–2).

## Step 1 — Measure the carve with the machine (spindle OFF)
Keep the XY zero you re-established at the bottom-left start corner.
1. Jog the bit tip dead center over the blackletter D in the Tigers shield.
   Write down X and Y from gSender's DRO.
2. Jog over open floor mid-Lake-Superior, lower Z until the tip just
   touches. Write down Z. Raise Z clear.

## Step 2 — Send Claude the three numbers (X, Y, Z)
X/Y at the crest give the exact scale (full-size reference: X96 Y98);
Z at the deepest floor gives the job's max depth (floor = 90% of max).
The touch-up file is regenerated to match and returned.

## Step 3 — Setup
- Bit: 1/16" tapered spiral (only tool for the whole job)
- XY zero: bottom-left start corner (already set — don't touch)
- Z zero: tip on the frame rim (untouched original surface)
- Grounded 3-prong charger cable; vacuum the board

## Step 4 — Run (built-in safety gate)
1. Load corrected file, start. Machine moves SPINDLE OFF to hover over the
   Tigers crest at Z6, then pauses itself (M0).
2. Bit over the crest → press Resume; spindle starts and the job runs.
   Bit anywhere else → press Stop (nothing cut) and report where it parked.
3. Watch the first minutes (feed-override responding = USB alive).
   ~75–85 min: A crest/compass/banner lines · B pockets around DAVID and
   the D · C roads, dots, pines · D wall-outline smoothing pass.
4. Ends spindle-off, parked at X0 Y0.

## Step 5 — Finish
Vacuum, light top-face sand, dark wax into all recessed detail (wipe the
surface), oil, hanger.
