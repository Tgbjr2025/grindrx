# DAVID — EST. 1989 · Great Lakes heirloom map with Tigers crest
### File: `david_lakes_depth.png` · for 400 × 330 × 25 mm stock (landscape)

The full Great Lakes basin from Natural Earth 10m data — all five lakes plus
Simcoe, Nipissing, Winnebago and St. Clair. Michigan stands 2 mm proud of the
neighboring land; the lakes step down in four bathymetric terraces. Ribbon
banner with raised DAVID letters and an EST. 1989 plate, engraved lake names,
seven cities with dots and highways (I-75, I-96, US-131, M-28), a Mackinac
Bridge glyph, ~260 carved pines, survey grid, compass rose with N/E/S/W, an
ornate frame with S-scroll channel and six baseball domes — and a Tigers-style
crest: crossed bats, baseball domes, DETROIT / TIGERS / MOTOWN ribbons, a
raised head with engraved tiger line art, and a raised blackletter D
(UnifrakturCook — evokes the Old English D without copying the registered mark).

**Depth encoding: white = surface (z = 0), black = 12 mm.**
`depth_mm = (1 − gray) × 12`. Image 3200 × 2640 px = 0.125 mm/px.

| Feature | Depth |
|---|---|
| Michigan, frame rims, banner, crest plates, raised letters/D | 0 |
| Other land (WI / ON / OH / IN) | 2.0 mm |
| Frame channel / banner face / shield field | 1.8 / 1.6 / 1.6 mm |
| Lake terraces | 4.2 / 6.4 / 8.6 / 10.8 mm |
| Baseball domes | spherical caps rising to surface |
| All engraving (labels, roads, trees, grid, scrolls, tiger art) | 0.9–1.5 mm below local surface |

## 1. Stock, zero, job
- 400 × 330 × 25, flattest face up; surface-skim 0.5 mm with the Eyryful bit.
- Clamp edge midpoints; everything is inside a 2 mm margin, no through-cuts.
- XY zero front-left, Z zero top face.
- CarveForge: size **400 × 330 mm**, max depth **12 mm**, white = surface, do
  NOT invert. A different blank? Scale proportionally — anything ≥ 360 mm wide
  keeps every feature above the 1/16" bit.

## 2. Pass schedule (hardwood, 11,000 RPM)
1. **Surfacing — Eyryful Ef01-10**: 0.5 mm skim, feed 2000. ~15 min.
2. **Roughing — 1/4" spiral up-cut**: stepdown 2.5 mm, stepover 40 %, feed
   1400, plunge 500, leave 0.3 mm. Clears the lakes (they're big at this
   scale). ~2.5 h.
3. **Finish — 1/8" up-cut**: full depth, stepover 30 %, feed 1000. Terrace
   walls, Michigan's 2 mm land step, crest plates, banner. ~1.3 h.
4. **Detail rest-pass — 1/16" tapered up-cut**: stepover 25 %, feed 700. The
   D's corners, bat/shield junctions, ribbon notches, tight coastline. ~45 min.
5. **Engraving — 60° V-bit**: all text, roads, trees, grid, scrolls, stitches,
   compass, tiger line art. Cut relative to the local floor (CarveForge does
   this from the image). Feed 700. ~50 min.

**Total ≈ 5.5–6 h.** Split it across two sessions at the tool changes if you
like — re-zero only Z on the same XY.

⚠ Same rig warning as always, doubly so at 6 hours: grounded 3-prong charger
cable, watch the feed-override for the first minutes, spindle off at the box
if the USB link wedges.

## 3. Finishing (this is where it becomes the reference photo)
The AI concept image is painted — the color is finish work, not carving:
- Seal coat, then **blue-tinted epoxy in the lake terraces** (2 pours, level
  below the land face) — the four steps give the depth-of-color gradient.
- **Michigan**: light stain or clear oil so the raised state glows.
- **Other land**: slightly darker stain (tan/olive) before oiling.
- **Crest**: navy + orange enamel picked into the ribbons and D if you want
  the Tigers colors; or leave monochrome wood — it reads either way.
- Dark wax rubbed into all engraving makes text/trees/grid pop like the render.
- Two-point hanger; at this size the piece is ~3 kg.

## 4. Notes
- `gen_david_v2.py` regenerates everything; name, year, city list, tree
  density and crest position are all near the top and parametric.
- Machinability verified: nothing a 1.6 mm bit can't reach beyond ~3 mm²
  corner fillets.
