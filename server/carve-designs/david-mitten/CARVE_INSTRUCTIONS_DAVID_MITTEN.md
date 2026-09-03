# THE D IN THE MITTEN — goodbye gift for David
### File: `david_mitten_depth.png` · for 300 × 250 × 25 mm stock · **PORTRAIT (250 wide × 300 tall)**

Real Census 5m boundary data — both peninsulas, Isle Royale, the Keweenaw,
Saginaw Bay and the Thumb are all genuinely there. The state stands at full
surface height wearing carved tiger stripes; the lakes step down in four
bathymetric terraces around it. At Detroit sits a sunken circular medallion
with a raised blackletter "D" (UnifrakturCook, an open-license blackletter —
evokes the Old English D without copying the trademarked mark). A compass
rose is engraved into the deep lake floor, and the bottom band carries
"DAVID" between two engraved baseballs.

**Depth encoding: white = surface (z = 0), black = 12 mm deep.**
`depth_mm = (1 − gray) × 12`. The state IS the untouched face — the grain is
the land. Image is 2000 × 2400 px = 0.125 mm/px.

| Feature | Depth |
|---|---|
| State surface / frame / band / medallion rim / raised D | 0 (untouched) |
| Tiger stripes (carved into the state) | 1.6 mm |
| Lake terrace 1 (shoreline shelf) | 3 mm |
| Terraces 2–4 | 5.5 / 8 / 10.5 mm |
| Medallion pocket (around the D) | 4.2 mm |
| Engraving: border grooves, band line, baseballs, DAVID, medallion ring | 1.5 mm |
| Compass rose (cut into lake floor) | floor + 1.5 mm |

## 1. Stock & workholding
- 300 × 250 × 25 stock, flattest face up. **Design is portrait: 250 mm wide ×
  300 mm tall** — mount the block with the 250 side as X.
- Face it first with the **Eyryful surfacing bit** (0.5 mm skim) — the state
  surface is the finished face, it must be clean.
- Clamp at edge midpoints; all carving is inside a 3 mm margin, no
  through-cuts, no tabs.

## 2. Zero
- XY zero: front-left corner. Z zero: top face after surfacing.

## 3. CarveForge job setup
- Image: `david_mitten_depth.png` · Size: **250 × 300 mm** · Max depth: **12 mm**
- White = surface. Do NOT invert. Do NOT scale down (features are sized to
  your bits at this scale).

## 4. Pass schedule (hardwood feeds, 11,000 RPM)

**Pass 0 — Surfacing, Eyryful Ef01-10**
- 0.5 mm skim, 60% stepover, feed 2000 mm/min. ~10 min.

**Pass 1 — Roughing, 1/4" spiral UP-cut (or the compression)**
- Stepdown 2.5 mm, stepover 40%, feed 1400 mm/min, plunge 500.
- Leave 0.3 mm floor/wall stock. Clears lake terraces + medallion pocket. ~60–75 min.
- Up-cut evacuates chips from the 10.5 mm floors; any top-edge fuzz is
  removed by the finish passes.

**Pass 2 — Finish, 1/8" spiral up-cut**
- Full depth, stepover 30%, feed 1000 mm/min, plunge 350.
- Crisps every terrace wall, the shoreline, the medallion and the wide
  stripes. ~45 min.

**Pass 3 — Detail finish (rest machining), 1/16" tapered spiral up-cut**
- Full depth where the 1/8" couldn't reach: stripe tips, the D's inner
  corners, tight coastline coves. Stepover 25%, feed 700, stepdown 1.5 mm.
- ~30–40 min. This bit is the whole reason the stripes can taper to points —
  don't skip it.

**Pass 4 — Engraving, 60° V-bit**
- Border grooves, band separator, DAVID, baseballs, medallion ring, compass
  rose. Lines are 0.8–1.2 mm wide, 1.5 mm deep — single pass, feed 700.
- The compass sits on the deep floor: your CAM must engrave relative to the
  depth map (CarveForge does this natively from the image). ~20 min.

**Total: ≈ 3 hours.** The 90° V, ball end, O-flute and down-cut stay in the
box for this one (down-cut is a fine roughing substitute if tear-out shows).

## 5. ⚠ Before this long carve
Same rig warning as the Great Lakes piece: the spindle-EMI USB dropout will
kill a 3-hour job. Grounded 3-prong cable on the laptop charger, watch the
feed-override slider for the first minutes, and if the link wedges: spindle
power off at the box, unplug/replug USB.

## 6. Finishing
- Vacuum, hand-sand the state face 180 → 220. Don't round the shoreline or
  the D — crisp edges are the piece.
- **Tiger option:** rub ebony or dark-walnut wax INTO the stripes only, then
  wipe the surface clean before it sets — dark stripes over wood = tiger, and
  it's David's Tigers navy-and-orange if you use tinted Danish oil instead.
- **Lakes option:** transparent blue-tinted epoxy poured into the lake
  terraces (2 layers, level below the state face) — the stepped floors give a
  real depth-of-color gradient. Oil everything after.
- Two-point hanger on the back; it's a ~1.5 kg piece.

## 7. Notes
- The name band is parametric — rerun `gen_david.py` to swap "DAVID" for
  anything (a date, "MICHIGAN MADE", initials) in a minute.
- The medallion D is a generic blackletter letterform, not the Tigers'
  registered logo — right call for a personal gift anyway.
