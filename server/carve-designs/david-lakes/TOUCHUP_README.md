# Touch-up job — SINGLE TOOL: 1/16" tapered spiral, no bit change

**Use `touchup_taper16_all.nc` — it replaces the older two-file pair.**
One bit, one file, one run (~75–85 min). GRBL/gSender dialect, mm, absolute.

**Zeroing: XY zero = same front-left corner as the original carve
(persists in the controller even across power cycles — don't re-set it).
Z zero = ORIGINAL top face: touch off on the frame rim (untouched surface).**

What it does, in order:
- **A — Bold re-engrave** (2 depth passes to −2.3 rel): tiger face, DETROIT /
  TIGERS / MOTOWN, EST. 1989, compass + N/E/S/W, stitches. Lines come out
  ~2 mm wide and flat-bottomed — bolder than the V-bit version, by design.
  Tiny dots (pupils, whiskers) are peck-drilled. Thin border-outline grooves
  are intentionally skipped (2 mm cuts would leave fragile ridge walls).
- **B — Pocket deepening** (1.6 → 3.0 mm, 2 passes): banner face around the
  raised DAVID letters and shield field around the D and tiger head.
  Radius-compensated — cannot touch the raised parts.
- **C — Roads, city dots, pines** re-cut to ~1.9 mm so they pop. Small map
  TEXT (city names, lake names, grid) is deliberately untouched: this bit's
  2 mm stroke would blob 4 mm letters. That text is 60° V-bit work only.
- **D — Edge smoothing contour pass**: traces the base of every wall
  (shoreline, terrace steps, plates, pockets) 0.75 mm off the wall, shaving
  raster fuzz. The taper leaves a slight chamfer on wall tops — that's the
  smoothing. Deepest move: Z −10.80 (bottom terrace edges).

The file only travels where work exists — rapids between features, no
full-board raster.

**Dry-run first:** spindle off, run the opening lines — first stop is the
banner/crest area. Feeds: 550–800 mm/min, plunges 220–300, S11000.
Verified by simulation: zero cuts outside the touch-up zones.

Afterwards: dark wax into all the deepened detail.
