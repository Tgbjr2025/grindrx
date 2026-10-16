#!/usr/bin/env python3
"""'The D in the Mitten' — goodbye-gift relief for David.

250 x 300 mm portrait plaque, 25 mm stock, max carve depth 12 mm.
Output: 8-bit grayscale depth map (white = surface z0, black = 12 mm deep)
at 0.125 mm/px (8 px/mm) -> 2000 x 2400 px, plus a lit color preview.
"""
import json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.ndimage import distance_transform_edt, gaussian_filter

PXMM = 8
W_MM, H_MM = 250, 300
W, H = W_MM * PXMM, H_MM * PXMM
MAXD = 12.0  # mm at black

def mm(v): return int(round(v * PXMM))

# ---------------- depth canvas: start at surface ----------------
depth = np.zeros((H, W), dtype=np.float32)  # mm of cut

# ---------------- Michigan geometry ----------------
d = json.load(open('us-states.json'))
mi = [f for f in d['features'] if f['properties'].get('NAME') == 'Michigan'][0]
polys = mi['geometry']['coordinates']  # MultiPolygon
# keep the two big peninsulas + nearby large islands
rings = [p[0] for p in polys if len(p[0]) > 40]

lat0 = 44.8
def proj(lon, lat):
    return lon * math.cos(math.radians(lat0)), lat

pts_all = [proj(x, y) for r in rings for x, y in r]
xs = [p[0] for p in pts_all]; ys = [p[1] for p in pts_all]
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)

# layout: frame margin 3mm, border grooves, bottom band 34mm
FRAME = 3.0
BAND_H = 34.0
top_pad, side_pad = 10.0, 8.0
region_w = W_MM - 2 * (FRAME + side_pad)
region_h = H_MM - FRAME - BAND_H - top_pad - FRAME - 6.0
sc = min(region_w / (maxx - minx), region_h / (maxy - miny))
gw, gh = (maxx - minx) * sc, (maxy - miny) * sc
ox = (W_MM - gw) / 2.0
oy = top_pad + FRAME + (region_h - gh) / 2.0

def to_px(lon, lat):
    x, y = proj(lon, lat)
    return (mm(ox + (x - minx) * sc), mm(oy + (maxy - y) * sc))

state_img = Image.new('L', (W, H), 0)
sd = ImageDraw.Draw(state_img)
for r in rings:
    sd.polygon([to_px(x, y) for x, y in r], fill=255)
# despeckle the 5m coastline at carve scale: fill notches and shave spits
# narrower than the 1.6mm finishing bit, drop islands smaller than ~3mm
state_img = state_img.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11))
state_img = state_img.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(9))
state = np.array(state_img) > 127

# ---------------- water: stepped bathymetric terraces ----------------
# distance (mm) from land for every water pixel
dist_mm = distance_transform_edt(~state) / PXMM
water_terraces = [(2.0, 3.0), (7.0, 5.5), (16.0, 8.0), (30.0, 10.5)]
wd = np.full((H, W), 10.5, dtype=np.float32)
for limit, dep in reversed(water_terraces):
    wd[dist_mm <= limit] = dep
wd[dist_mm <= 0.6] = 0.0  # thin surface rim hugging the shoreline? -> no, keep crisp wall
wd[state] = 0.0
# actually cut walls right at shoreline: water starts immediately
wd[(~state) & (dist_mm <= 2.0)] = 3.0
depth = np.maximum(depth, wd)

# frame + band stay at surface (override water)
frame_mask = np.zeros((H, W), dtype=bool)
frame_mask[:mm(FRAME + 0), :] = True; frame_mask[-mm(int(FRAME)):, :] = True
frame_mask[:, :mm(FRAME)] = True; frame_mask[:, -mm(FRAME):] = True
band_top = H - mm(FRAME + BAND_H)
band_mask = np.zeros((H, W), dtype=bool)
band_mask[band_top:, :] = True
depth[frame_mask | band_mask] = 0.0

# ---------------- tiger stripes on the state ----------------
rng = np.random.default_rng(7)
def smooth_noise(scale_mm, amp):
    small = rng.standard_normal((H // (PXMM * 4) + 2, W // (PXMM * 4) + 2))
    n = gaussian_filter(small, scale_mm / 4.0, mode='nearest')
    n = (n - n.mean()) / (n.std() + 1e-9)
    return amp * np.array(Image.fromarray(n.astype(np.float32)).resize((W, H), Image.BILINEAR))

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u = xx / PXMM; v = yy / PXMM
# stripe direction slowly rotates across the piece; heavy smooth warp -> organic bands
ang = math.radians(20) + 0.35 * np.sin(v / 95.0) * np.cos(u / 120.0)
s = u * np.sin(ang) + v * np.cos(ang)
warp = smooth_noise(10.0, 9.0) + 3.0 * np.sin(u / 17.0 + 0.8)
phase = (s + warp) / 15.5 * 2 * math.pi
band = 0.5 + 0.5 * np.cos(phase)
# varying threshold: stripes swell, pinch and break like real tiger markings
thresh = 0.58 + smooth_noise(14.0, 0.22)
stripes = band > thresh
# keep stripes 2.2mm off the shoreline so the state edge stays a clean wall
inset = distance_transform_edt(state) / PXMM > 2.2
stripe_mask = stripes & state & inset
# drop stripe slivers thinner than ~2mm (finest bit is 1.6mm)
sm = Image.fromarray((stripe_mask * 255).astype(np.uint8))
sm = sm.filter(ImageFilter.MinFilter(11)).filter(ImageFilter.MaxFilter(11))
# close gaps thinner than ~1.8mm so no fragile raised ribs are left between stripes
sm = sm.filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.MinFilter(15))
stripe_mask = (np.array(sm) > 127) & state & inset
depth[stripe_mask] = np.maximum(depth[stripe_mask], 1.6)

# ---------------- Detroit medallion with raised blackletter D ----------------
DET_LON, DET_LAT = -83.05, 42.33
cx, cy = to_px(DET_LON, DET_LAT)
cx += mm(3); cy -= mm(7)  # nudge so the badge sits nicely over the thumb/Erie corner
R_OUT, RIM, POCKET_D = mm(26), mm(3.2), 4.2
med = Image.new('L', (W, H), 0)
mdr = ImageDraw.Draw(med)
mdr.ellipse([cx - R_OUT, cy - R_OUT, cx + R_OUT, cy + R_OUT], fill=255)
med_all = np.array(med) > 127
mdr.ellipse([cx - R_OUT + RIM, cy - R_OUT + RIM, cx + R_OUT - RIM, cy + R_OUT - RIM], fill=128)
med_in = np.array(med) == 128
# rim ring at surface, pocket floor at 4.2mm — wipe stripes/water beneath the badge
depth[med_all] = 0.0
depth[med_in] = POCKET_D
# raised D: back to surface height inside the pocket
fnt = ImageFont.truetype('UnifrakturCook-Bold.ttf', mm(40))
dimg = Image.new('L', (W, H), 0)
dd = ImageDraw.Draw(dimg)
bb = dd.textbbox((0, 0), 'D', font=fnt)
dw, dh = bb[2] - bb[0], bb[3] - bb[1]
dd.text((cx - dw / 2 - bb[0], cy - dh / 2 - bb[1]), 'D', font=fnt, fill=255)
dmask = np.array(dimg) > 127
# thicken slightly then ensure it stays inside the pocket
dmask = np.array(Image.fromarray((dmask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 127
dmask &= med_in
depth[dmask] = 0.0

# ---------------- engraved detail (V-carve look: shallow narrow cuts) ---------
eng = Image.new('L', (W, H), 0)
ed = ImageDraw.Draw(eng)

def line(p, q, wmm, img_draw=None):
    (img_draw or ed).line([p, q], fill=255, width=max(1, mm(wmm)))

# double border groove
for off in (FRAME + 2.0, FRAME + 4.2):
    o = mm(off)
    ed.rectangle([o, o, W - o, H - o], outline=255, width=mm(1.1))
# band separator groove
ed.line([(mm(FRAME + 2.0), band_top + mm(2)), (W - mm(FRAME + 2.0), band_top + mm(2))],
        fill=255, width=mm(1.1))

# baseballs flanking the name: circle + two stitch arcs + stitch ticks
def baseball(bx, by, r):
    ed.ellipse([bx - r, by - r, bx + r, by + r], outline=255, width=mm(1.0))
    for sgn in (-1, 1):
        arc_c = bx + sgn * r * 1.35
        bbox = [arc_c - r * 0.95, by - r * 0.95, arc_c + r * 0.95, by + r * 0.95]
        st, en = (110, 250) if sgn > 0 else (-70, 70)
        ed.arc(bbox, st, en, fill=255, width=mm(0.9))
        for t in np.linspace(st + 15, en - 15, 5):
            a = math.radians(t)
            px_, py_ = arc_c + r * 0.95 * math.cos(a), by + r * 0.95 * math.sin(a)
            dxn, dyn = math.cos(a), math.sin(a)
            ed.line([(px_ - dxn * mm(2.2), py_ - dyn * mm(2.2)),
                     (px_ + dxn * mm(2.2), py_ + dyn * mm(2.2))], fill=255, width=mm(0.8))

bandc_y = band_top + mm((BAND_H - FRAME) / 2 + 1.5)
baseball(mm(38), bandc_y, mm(10))
baseball(W - mm(38), bandc_y, mm(10))

# name: letterspaced serif caps for legibility
nf = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', mm(15))
name = 'DAVID'
sp = mm(4)
widths = []
for ch in name:
    b = ed.textbbox((0, 0), ch, font=nf)
    widths.append((b, b[2] - b[0]))
tot = sum(w for _, w in widths) + sp * (len(name) - 1)
x0 = W / 2 - tot / 2
for ch, (b, w) in zip(name, widths):
    ed.text((x0 - b[0], bandc_y - (b[3] - b[1]) / 2 - b[1]), ch, font=nf, fill=255)
    x0 += w + sp
# engraved ring on the medallion rim
ed.ellipse([cx - R_OUT + mm(1.0), cy - R_OUT + mm(1.0),
            cx + R_OUT - mm(1.0), cy + R_OUT - mm(1.0)], outline=255, width=mm(0.8))

eng_mask = np.array(eng) > 127
# engraving cuts 1.5mm, only where surface is currently at 0 (band, frame, rim...)
cuttable = depth < 0.1
depth[eng_mask & cuttable] = 1.5

# ---------------- compass rose engraved into the deep-water floor -------------
comp = Image.new('L', (W, H), 0)
cd_ = ImageDraw.Draw(comp)
ccx, ccy, cr = mm(197), mm(64), mm(21)
cd_.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], outline=255, width=mm(1.0))
cd_.ellipse([ccx - cr * 0.72, ccy - cr * 0.72, ccx + cr * 0.72, ccy + cr * 0.72],
            outline=255, width=mm(0.8))
for i in range(8):
    a = math.pi / 4 * i
    L = cr * (0.95 if i % 2 == 0 else 0.62)
    tip = (ccx + L * math.sin(a), ccy - L * math.cos(a))
    wv = mm(2.4 if i % 2 == 0 else 1.6)
    base1 = (ccx + wv * math.sin(a + math.pi / 2), ccy - wv * math.cos(a + math.pi / 2))
    base2 = (ccx + wv * math.sin(a - math.pi / 2), ccy - wv * math.cos(a - math.pi / 2))
    cd_.polygon([tip, base1, base2], fill=255)
comp_mask = (np.array(comp) > 127) & (~state) & (depth >= 5.4) & (~med_all) & (~frame_mask)
depth[comp_mask] += 1.5

# ---------------- render outputs ----------------
depth = np.clip(depth, 0, MAXD)
gray = np.round(255 * (1 - depth / MAXD)).astype(np.uint8)
Image.fromarray(gray).save('david_mitten_depth.png')

# lit preview: cherry-ish tones + slope shading
hmap = (MAXD - depth)
gx, gy = np.gradient(gaussian_filter(hmap, 1.2))
nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
lx, ly, lz = -0.5, -0.6, 0.63
shade = np.clip((-gx * lx - gy * ly + lz) * nz, 0, 1)
t = depth / MAXD
base = np.stack([214 - 90 * t, 178 - 95 * t, 138 - 88 * t], axis=-1)
img = np.clip(base * (0.55 + 0.55 * shade)[..., None], 0, 255).astype(np.uint8)
Image.fromarray(img).save('david_mitten_preview.png')
print('depth stats mm: min', depth.min(), 'max', depth.max())
print('stripe area %:', 100 * stripe_mask.sum() / state.sum())
print('done')
