# FINAL TOUCH-UP — real-frame cut files (verified)

Reconstructed from the actual file that ran (`relief_aac23d13_finish_V3_POP.gcode`)
and its correct-frame touch-up set pulled from the M1 Desktop. The real board is
**191.85 x 226.7 mm, PORTRAIT** — the map is rotated 90 deg vs the earlier
landscape design, which is why every earlier hand-built file drove off. These are
in the REAL coordinate frame and verified inside the 450x400 envelope.

All four use ONE bit: the **1/16" tapered** (your Tapered Spiral Up Cut 1/16";
the prior operator called it a tapered ball nose — same holder, run it either way).
Every file is spindle-OFF-gated: it parks over the first cut point and pauses (M0)
BEFORE the spindle starts. On the pause, look at the camera/bit — if it is over the
named feature, resume; if not, STOP, nothing has been cut.

## Files 1 & 2 use the GLOBAL zero — DO NOT RE-ZERO
Same G54 XYZ zero as the original carve. Z0 = original stock top (touch off the
frame rim if you must re-establish Z). XY zero = the original bottom-left start.

- **cut_1of4_deepen_3obj.gcode** — deepens compass, Tigers medallion, and DAVID
  name to full V3 depth (to the -14 floor on the name + medallion, -11 on the
  compass). This is the "make it deep enough to see" pass. Hover parks over the
  LEFT-edge DAVID banner.
- **cut_2of4_faces_and_edge_smoothing.gcode** — skims the three feature faces flat
  and traces 117 object edges to clean the bit marks off the sloped sides. This is
  the edge-smoothing pass you asked for. Run AFTER cut_1.

## Files 3 & 4 use a LOCAL zero — these are the safest, run these if unsure
Each re-engraves one feature from its own zero, so the 90 deg rotation cannot
throw them off. Jog to the marked point, zero X/Y/Z THERE, then run.

- **cut_3of4_badge_D_localzero.gcode** — fresh 2 mm-deep blackletter D.
  Zero at the CENTER of the Tigers badge. Cuts within a +/-21 mm box.
- **cut_4of4_DAVID_letters_localzero.gcode** — fresh 2 mm-deep DAVID name.
  Zero at the TOP-LEFT corner of the first D. Letters run in the -Y direction
  (down the board) for ~105 mm — confirms the rotation; make sure -Y has travel.

## Suggested order
If you only care that the name/D/compass read clearly: run **3** and **4** first
(local-zero, safest), eyeball the result, then **1** for the compass, then **2**
to smooth edges. Wax the recesses dark when done.

Dry-run each: with spindle off and Z safe, let it reach the M0 pause and confirm
the park point before resuming. These were reconstructed/curated by Claude from
your own files, not authored blind — but the hover check is still mandatory.
