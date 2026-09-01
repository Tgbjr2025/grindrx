#!/usr/bin/env python3
"""DAVID — EST. 1989: Great Lakes heirloom map with Tigers crest.

400 x 330 mm landscape, 25 mm stock, max depth 12 mm.
White = surface (z0), black = 12 mm. 0.125 mm/px -> 3200 x 2640 px.
Levels: Michigan/raised work = 0, other land = 2.0, water terraces
4.2/6.4/8.6/10.8, frame channel 1.8. Engraving is cut relative to the
local surface after all levels are set.
"""
import json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from scipy.ndimage import distance_transform_edt, gaussian_filter

PXMM = 8
W_MM, H_MM = 400, 330
W, H = W_MM * PXMM, H_MM * PXMM
MAXD = 12.0
def mm(v): return int(round(v * PXMM))

L_TOP, L_LAND, L_CHAN = 0.0, 2.0, 1.8
TERR = [(3.0, 4.2), (10.0, 6.4), (20.0, 8.6), (1e9, 10.8)]

FR = 16.0           # frame width
IN_X0, IN_Y0 = mm(FR), mm(FR)
IN_X1, IN_Y1 = W - mm(FR), H - mm(FR)

SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
BLACKLETTER = 'UnifrakturCook-Bold.ttf'

# ---------------------------------------------------------------- geometry
lakes_json = json.load(open('ne_lakes.geojson'))
states = json.load(open('us-states.json'))
mi = [f for f in states['features'] if f['properties'].get('NAME') == 'Michigan'][0]

LON0, LON1, LAT0, LAT1 = -92.6, -78.0, 40.9, 49.15
lat_m = 44.9
def proj(lon, lat):
    return lon * math.cos(math.radians(lat_m)), lat
p0, p1 = proj(LON0, LAT0), proj(LON1, LAT1)
gw, gh = p1[0] - p0[0], p1[1] - p0[1]
sc = min((IN_X1 - IN_X0) / mm(1) / (gw * PXMM / PXMM), 0) # placeholder
sc = min((IN_X1 - IN_X0) / (gw), (IN_Y1 - IN_Y0) / (gh))  # px per proj-unit
ox = (IN_X0 + IN_X1) / 2 - sc * (p0[0] + p1[0]) / 2
oy = (IN_Y0 + IN_Y1) / 2 + sc * (p0[1] + p1[1]) / 2
def to_px(lon, lat):
    x, y = proj(lon, lat)
    return (ox + sc * x, oy - sc * y)

def rings_of(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    return [p[0] for p in geom['coordinates']]

GREAT = ['Lake Superior', 'Lake Michigan', 'Lake Huron', 'Lake Erie', 'Lake Ontario']
SMALL = ['Lake Simcoe', 'Lake Nipissing', 'Lake Winnebago']
great_img = Image.new('L', (W, H), 0); gd = ImageDraw.Draw(great_img)
small_img = Image.new('L', (W, H), 0); sd2 = ImageDraw.Draw(small_img)
for f in lakes_json['features']:
    n = f['properties'].get('name')
    if n in GREAT:
        for r in rings_of(f['geometry']):
            gd.polygon([to_px(x, y) for x, y in r], fill=255)
    elif n in SMALL:
        for r in rings_of(f['geometry']):
            sd2.polygon([to_px(x, y) for x, y in r], fill=255)
# Lake St. Clair (missing from 10m set): small ellipse
scx, scy = to_px(-82.68, 42.45)
gd.ellipse([scx - mm(5), scy - mm(4), scx + mm(5), scy + mm(4)], fill=255)

mi_img = Image.new('L', (W, H), 0); md = ImageDraw.Draw(mi_img)
for r in [p[0] for p in mi['geometry']['coordinates'] if len(p[0]) > 40]:
    md.polygon([to_px(x, y) for x, y in r], fill=255)

def despeckle(img, close=11, open_=9):
    img = img.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    return img.filter(ImageFilter.MinFilter(open_)).filter(ImageFilter.MaxFilter(open_))
great_img, small_img, mi_img = (despeckle(great_img), despeckle(small_img, 9, 7),
                                despeckle(mi_img))
great = np.array(great_img) > 127
small = (np.array(small_img) > 127) & ~great
mimask = (np.array(mi_img) > 127) & ~great

# ------------------------------------------------------------- base levels
depth = np.full((H, W), L_LAND, dtype=np.float32)
depth[mimask] = L_TOP
dist_mm = distance_transform_edt(~(~great)) / PXMM  # dist inside great lakes to shore
for lim, dv in reversed(TERR):
    depth[great & (dist_mm <= lim)] = dv
for lim, dv in TERR:
    pass
# apply terraces properly (nearest first overwritten by deeper): redo
depth[great] = TERR[-1][1]
for lim, dv in reversed(TERR[:-1]):
    depth[great & (dist_mm <= lim)] = dv
depth[small] = 4.2

# frame: rims at 0, channel at 1.8
frame_zone = np.zeros((H, W), dtype=bool)
frame_zone[:mm(FR), :] = True; frame_zone[-mm(FR):, :] = True
frame_zone[:, :mm(FR)] = True; frame_zone[:, -mm(FR):] = True
edge = np.zeros((H, W), dtype=np.float32)
yy, xx = np.mgrid[0:H, 0:W]
d_edge = np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)) / PXMM
chan = frame_zone & (d_edge >= 4.5) & (d_edge <= 12.5)
depth[frame_zone] = 0.0
depth[chan] = L_CHAN

surface_pre = None  # snapshot later, after all plates

# ------------------------------------------------------- raised plates: banner
plates = Image.new('L', (W, H), 0)   # 255 = force to surface 0
pockets = []                          # (mask, depth) applied after plates
pd = ImageDraw.Draw(plates)

BAN_W, BAN_H = 180.0, 34.0
bx0 = W / 2 - mm(BAN_W / 2); bx1 = W / 2 + mm(BAN_W / 2)
by0 = mm(8); by1 = by0 + mm(BAN_H)
# swallow tails
tail_w = mm(26)
pd.polygon([(bx0 - tail_w, by0 + mm(6)), (bx0 + mm(6), by0 + mm(3)),
            (bx0 + mm(6), by1 - mm(3)), (bx0 - tail_w, by1 - mm(6)),
            (bx0 - tail_w + mm(9), by0 + mm(BAN_H / 2))], fill=255)
pd.polygon([(bx1 + tail_w, by0 + mm(6)), (bx1 - mm(6), by0 + mm(3)),
            (bx1 - mm(6), by1 - mm(3)), (bx1 + tail_w, by1 - mm(6)),
            (bx1 + tail_w - mm(9), by0 + mm(BAN_H / 2))], fill=255)
pd.rounded_rectangle([bx0, by0, bx1, by1], radius=mm(4), fill=255)
# EST plate
ex0, ex1 = W / 2 - mm(46), W / 2 + mm(46)
ey0, ey1 = by1 + mm(2), by1 + mm(16)
pd.rounded_rectangle([ex0, ey0, ex1, ey1], radius=mm(3), fill=255)

# banner face pocket (letters stay raised)
face = Image.new('L', (W, H), 0); fd = ImageDraw.Draw(face)
fd.rounded_rectangle([bx0 + mm(3), by0 + mm(3), bx1 - mm(3), by1 - mm(3)],
                     radius=mm(3), fill=255)
fnt_dav = ImageFont.truetype(SERIF, mm(22))
tb = fd.textbbox((0, 0), 'DAVID', font=fnt_dav)
tw, th = tb[2] - tb[0], tb[3] - tb[1]
letters = Image.new('L', (W, H), 0); ld = ImageDraw.Draw(letters)
ld.text((W / 2 - tw / 2 - tb[0], (by0 + by1) / 2 - th / 2 - tb[1]), 'DAVID',
        font=fnt_dav, fill=255)
letters = letters.filter(ImageFilter.MaxFilter(5))
face_m = (np.array(face) > 127) & ~(np.array(letters) > 127)
pockets.append((face_m, 1.6))

# ------------------------------------------------------------- Tigers crest
CCX, CCY = mm(96), mm(232)          # crest center (over Lake Michigan)
SH_W, SH_H = 56.0, 64.0             # shield half-extents in mm

def shield_path(cx, cy, hw, hh):
    p = []
    for t in np.linspace(0, 1, 60):   # top edge, slight arc
        p.append((cx - hw + 2 * hw * t, cy - hh + mm(3) * math.sin(math.pi * t)))
    for t in np.linspace(0, 1, 80):   # right side to bottom point
        a = t * math.pi / 2
        p.append((cx + hw * math.cos(a) ** 0.7, cy - hh + (2 * hh) * math.sin(a)))
    for t in np.linspace(1, 0, 80):
        a = t * math.pi / 2
        p.append((cx - hw * math.cos(a) ** 0.7, cy - hh + (2 * hh) * math.sin(a)))
    return p

# crossed bats (raised, behind shield)
bat_layer = Image.new('L', (W, H), 0); bd = ImageDraw.Draw(bat_layer)
def bat(cx, cy, ang_deg, L=mm(150)):
    a = math.radians(ang_deg)
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -uy, ux
    p1 = (cx - ux * L / 2, cy - uy * L / 2)  # knob end
    p2 = (cx + ux * L / 2, cy + uy * L / 2)  # barrel end
    w1, w2 = mm(3.2), mm(6.5)
    poly = [(p1[0] + nx * w1, p1[1] + ny * w1), (p2[0] + nx * w2, p2[1] + ny * w2),
            (p2[0] - nx * w2, p2[1] - ny * w2), (p1[0] - nx * w1, p1[1] - ny * w1)]
    bd.polygon(poly, fill=255)
    bd.ellipse([p2[0] - w2, p2[1] - w2, p2[0] + w2, p2[1] + w2], fill=255)
    bd.ellipse([p1[0] - w1 * 1.5, p1[1] - w1 * 1.5, p1[0] + w1 * 1.5, p1[1] + w1 * 1.5], fill=255)
bat(CCX, CCY, 35); bat(CCX, CCY, 145)

sh_outer = Image.new('L', (W, H), 0); so = ImageDraw.Draw(sh_outer)
so.polygon(shield_path(CCX, CCY, mm(SH_W / 2), mm(SH_H / 2)), fill=255)
sh_inner = Image.new('L', (W, H), 0); si = ImageDraw.Draw(sh_inner)
si.polygon(shield_path(CCX, CCY, mm(SH_W / 2 - 4), mm(SH_H / 2 - 4)), fill=255)

# baseballs flanking shield (domes)
BALLS = [(CCX - mm(49), CCY + mm(16), mm(9.5)), (CCX + mm(49), CCY + mm(16), mm(9.5))]

# ribbons
rib = Image.new('L', (W, H), 0); rd = ImageDraw.Draw(rib)
def ribbon(cx, cy, w, h, skew=6):
    rd.polygon([(cx - w / 2 - mm(skew), cy - h / 2 + mm(2)), (cx + w / 2 + mm(skew), cy - h / 2 + mm(2)),
                (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)], fill=255)
    rd.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], fill=255)
RIB1 = (CCX, CCY - mm(SH_H / 2) - mm(14), mm(86), mm(13))
RIB2 = (CCX, CCY + mm(SH_H / 2) + mm(6), mm(80), mm(12))
RIB3 = (CCX, CCY + mm(SH_H / 2) + mm(21), mm(64), mm(11))
for r_ in (RIB1, RIB2, RIB3): ribbon(*r_[:2], r_[2], r_[3])

crest_plate = np.array(bat_layer) > 127
crest_plate |= np.array(sh_outer) > 127
crest_plate |= np.array(rib) > 127
for bxc, byc, br in BALLS:
    bb = Image.new('L', (W, H), 0)
    ImageDraw.Draw(bb).ellipse([bxc - br, byc - br, bxc + br, byc + br], fill=255)
    crest_plate |= np.array(bb) > 127
pockets.append(((np.array(sh_inner) > 127), 1.6))

# raised D on the shield field (lower half)
fnt_D = ImageFont.truetype(BLACKLETTER, mm(25))
Dimg = Image.new('L', (W, H), 0); Dd = ImageDraw.Draw(Dimg)
db = Dd.textbbox((0, 0), 'D', font=fnt_D)
Dd.text((CCX - (db[2] - db[0]) / 2 - db[0], CCY + mm(16) - (db[3] - db[1]) / 2 - db[1]),
        'D', font=fnt_D, fill=255)
Dmask = np.array(Dimg.filter(ImageFilter.MaxFilter(3))) > 127

# ---- tiger face: raised head silhouette + engraved line art (upper shield)
TFX, TFY, TS = CCX, CCY - mm(19), mm(1)  # TS: 1mm unit
head = Image.new('L', (W, H), 0); hd = ImageDraw.Draw(head)
hw = 19  # head half width mm
hd.ellipse([TFX - TS * hw, TFY - TS * (hw * 0.92), TFX + TS * hw, TFY + TS * (hw * 0.98)], fill=255)
for sgn in (-1, 1):  # ears
    exc, eyc = TFX + sgn * TS * hw * 0.74, TFY - TS * hw * 0.80
    hd.ellipse([exc - TS * 6.2, eyc - TS * 6.2, exc + TS * 6.2, eyc + TS * 6.2], fill=255)
head_m = (np.array(head) > 127)

tiger = Image.new('L', (W, H), 0); tg = ImageDraw.Draw(tiger)
def tl(pts, w):
    tg.line([(TFX + TS * x, TFY + TS * y) for x, y in pts], fill=255,
            width=max(2, int(TS * w)), joint='curve')
def tpoly(pts):
    tg.polygon([(TFX + TS * x, TFY + TS * y) for x, y in pts], fill=255)
for sgn in (-1, 1):
    s = sgn
    # inner ear
    tl([(s * 11.0, -17.0), (s * 14.5, -19.2), (s * 16.6, -14.8)], 1.5)
    # angled brow (thick, expressive)
    tl([(s * 3.2, -8.8), (s * 8.5, -10.6), (s * 13.0, -8.0)], 1.9)
    # eye: almond outline + pupil
    tl([(s * 4.6, -4.6), (s * 8.2, -6.4), (s * 12.0, -4.4)], 1.4)
    tl([(s * 4.6, -4.3), (s * 8.2, -2.4), (s * 12.0, -4.1)], 1.4)
    tg.ellipse([TFX + TS * (s * 8.3 - 1.5), TFY + TS * (-4.5 - 1.5),
                TFX + TS * (s * 8.3 + 1.5), TFY + TS * (-4.5 + 1.5)], fill=255)
    # two cheek stripes, angled down-in, tapered
    for i, (yb, ln, dyv) in enumerate([(1.2, 7.5, 2.2), (6.0, 6.0, 2.6)]):
        x0_ = s * (hw - 0.8); x1_ = s * (hw - 0.8 - ln)
        tpoly([(x0_, yb - 1.7), (x1_, yb + dyv), (x0_, yb + 1.9)])
    # muzzle arc framing the mouth
    tl([(s * 2.6, 7.6), (s * 6.4, 8.4), (s * 8.8, 11.4)], 1.4)
    # whisker dots
    for wx, wy in [(5.2, 10.0), (6.8, 11.6)]:
        tg.ellipse([TFX + TS * (s * wx - 0.55), TFY + TS * (wy - 0.55),
                    TFX + TS * (s * wx + 0.55), TFY + TS * (wy + 0.55)], fill=255)
# forehead: center stripe + chevrons
tpoly([(-1.5, -16.5), (0, -11.5), (1.5, -16.5)])
tl([(-4.2, -14.0), (-2.6, -10.2), (0, -11.8), (2.6, -10.2), (4.2, -14.0)], 1.5)
# nose bridge, nose pad, philtrum, mouth, chin
tl([(0, -1.6), (0, 2.6)], 1.6)
tpoly([(-3.0, 3.0), (3.0, 3.0), (0, 6.6)])
tl([(0, 6.4), (0, 8.8)], 1.4)
tl([(-5.6, 10.6), (-2.6, 12.4), (0, 11.0), (2.6, 12.4), (5.6, 10.6)], 1.5)
tl([(-2.2, 15.4), (0, 16.3), (2.2, 15.4)], 1.3)
tiger_m = (np.array(tiger) > 127) & head_m

crest_plate |= head_m  # head sits proud like the plate

# apply plates: force to surface, then pockets, then raised details
plates_m = (np.array(plates) > 127) | crest_plate
depth[plates_m] = 0.0
for mk, dv in pockets:
    depth[mk & ~Dmask & ~head_m] = dv
depth[Dmask] = 0.0
# baseball domes: spherical caps rising from shield pocket floor
for bxc, byc, br in BALLS:
    ys, xs_ = np.mgrid[int(byc - br):int(byc + br + 1), int(bxc - br):int(bxc + br + 1)]
    rr = np.sqrt((xs_ - bxc) ** 2 + (ys - byc) ** 2) / br
    inside = rr <= 1.0
    cap = 1.6 * (1 - np.sqrt(np.clip(1 - rr ** 2, 0, 1)))
    reg = depth[int(byc - br):int(byc + br + 1), int(bxc - br):int(bxc + br + 1)]
    reg[inside] = cap[inside]

surface = depth.copy()   # levels snapshot; engraving cuts relative to this
eng = []                 # list of (mask, depth_below_surface)

def eng_mask(img_mask, amt):
    eng.append((img_mask, amt))

# tiger line art (1.3 into the head plate)
eng_mask(tiger_m, 1.3)

# ------------------------------------------------------------ text helpers
def stamp_text(text, cx, cy, size_mm_, rot=0.0, font=SERIF, spacing=0):
    f = ImageFont.truetype(font, mm(size_mm_))
    tmp = Image.new('L', (mm(size_mm_) * (len(text) + 2), mm(size_mm_ * 2)), 0)
    td = ImageDraw.Draw(tmp)
    if spacing:
        x = float(mm(size_mm_ // 2))
        ybase = mm(size_mm_ * 0.5)
        for ch in text:
            td.text((x, ybase), ch, font=f, fill=255)
            x += f.getlength(ch) + mm(spacing)
    else:
        td.text((mm(size_mm_ // 2), mm(size_mm_ * 0.4)), text, font=f, fill=255)
    bbox = tmp.getbbox()
    if not bbox: return np.zeros((H, W), dtype=bool)
    tmp = tmp.crop(bbox)
    if rot: tmp = tmp.rotate(rot, expand=True, resample=Image.BICUBIC)
    out = Image.new('L', (W, H), 0)
    out.paste(tmp, (int(cx - tmp.width / 2), int(cy - tmp.height / 2)))
    return np.array(out) > 127

occupied = plates_m.copy()

# EST. 1989 engraved on its plate
m = stamp_text('EST. 1989', W / 2, (ey0 + ey1) / 2, 7.5, spacing=1.2)
eng_mask(m, 1.4); occupied |= m
# ribbons text
for txt, r_ in [('DETROIT', RIB1), ('TIGERS', RIB2), ('MOTOWN', RIB3)]:
    m = stamp_text(txt, r_[0], r_[1], min(7.2, r_[3] / PXMM * 0.62), spacing=1.0)
    eng_mask(m, 1.3); occupied |= m
# baseball stitches on the corner + crest balls come later with frame

# ------------------------------------------------------------- lake labels
def lake_label(text, lon, lat, size, rot):
    x, y = to_px(lon, lat)
    m = stamp_text(text, x, y, size, rot=rot, spacing=1.4)
    m &= (surface > 3.0)   # only into water floors
    eng_mask(m, 1.4);
    return m
occupied |= lake_label('LAKE SUPERIOR', -87.7, 47.55, 7.5, -12)
occupied |= lake_label('LAKE MICHIGAN', -86.85, 44.55, 6.0, 80)
occupied |= lake_label('LAKE HURON', -82.35, 44.7, 6.5, 55)
occupied |= lake_label('GEORGIAN BAY', -80.55, 45.6, 4.2, 45)
occupied |= lake_label('LAKE ERIE', -80.6, 42.2, 6.0, 18)
occupied |= lake_label('LAKE ONTARIO', -79.05, 43.65, 4.2, 24)

# ------------------------------------------------------------------ cities
CITIES = [('DETROIT', -83.05, 42.33, 4.6, -13, 5), ('GRAND RAPIDS', -85.67, 42.96, 4.4, 17, -2),
          ('LANSING', -84.55, 42.73, 4.4, 9, 5), ('FLINT', -83.69, 43.01, 4.0, 8, -4),
          ('TRAVERSE CITY', -85.62, 44.76, 4.2, 16, -3), ('MARQUETTE', -87.4, 46.55, 4.2, 5, 6),
          ('SAULT STE. MARIE', -84.35, 46.5, 4.0, 19, -4)]
dots = Image.new('L', (W, H), 0); dd2 = ImageDraw.Draw(dots)
for name, lon, lat, sz, dx, dy in CITIES:
    x, y = to_px(lon, lat)
    dd2.ellipse([x - mm(1.4), y - mm(1.4), x + mm(1.4), y + mm(1.4)], fill=255)
    m = stamp_text(name, x + mm(dx), y + mm(dy), sz, spacing=0.7)
    eng_mask(m, 1.2); occupied |= m
dm = np.array(dots) > 127
eng_mask(dm & mimask, 1.4); occupied |= dm

# Mackinac bridge glyph + label
mbx, mby = to_px(-84.72, 45.815)
mb = Image.new('L', (W, H), 0); mbd = ImageDraw.Draw(mb)
mbd.line([(mbx - mm(7), mby + mm(1)), (mbx + mm(7), mby + mm(1))], fill=255, width=mm(1.0))
for tx in (-3.5, 3.5):
    mbd.line([(mbx + mm(tx), mby + mm(2.5)), (mbx + mm(tx), mby - mm(3))], fill=255, width=mm(0.9))
mbd.arc([mbx - mm(7), mby - mm(2.6), mbx + mm(0.2), mby + mm(3)], 180, 360, fill=255, width=mm(0.7))
mbd.arc([mbx - mm(0.2), mby - mm(2.6), mbx + mm(7), mby + mm(3)], 180, 360, fill=255, width=mm(0.7))
mbm = np.array(mb) > 127
eng_mask(mbm, 1.3); occupied |= mbm
m = stamp_text('MACKINAC BRIDGE', mbx + mm(1), mby - mm(7), 3.6, spacing=0.6)
eng_mask(m, 1.1); occupied |= m

# ------------------------------------------------------------------- roads
roads = Image.new('L', (W, H), 0); rdd = ImageDraw.Draw(roads)
def road(pts):
    rdd.line([to_px(x, y) for x, y in pts], fill=255, width=mm(0.9), joint='curve')
road([(-83.05, 42.33), (-83.69, 43.01), (-83.9, 43.6), (-84.45, 44.3), (-84.6, 45.0), (-84.72, 45.78)])   # I-75 south
road([(-84.72, 45.85), (-84.4, 46.1), (-84.35, 46.47)])                                                    # I-75 north
road([(-83.05, 42.33), (-84.55, 42.73), (-85.67, 42.96)])                                                  # I-96
road([(-85.67, 42.96), (-85.55, 43.8), (-85.62, 44.72)])                                                   # US-131
road([(-87.4, 46.52), (-86.2, 46.4), (-85.0, 46.35), (-84.4, 46.47)])                                      # M-28
rm = (np.array(roads) > 127) & mimask & ~occupied
eng_mask(rm, 1.1)
occupied |= np.array(roads.filter(ImageFilter.MaxFilter(9))) > 127

# ------------------------------------------------------------ survey grid
grid = Image.new('L', (W, H), 0); gdd = ImageDraw.Draw(grid)
for gx in range(IN_X0 + mm(20), IN_X1, mm(42)):
    gdd.line([(gx, IN_Y0), (gx, IN_Y1)], fill=255, width=mm(0.7))
for gy in range(IN_Y0 + mm(20), IN_Y1, mm(42)):
    gdd.line([(IN_X0, gy), (IN_X1, gy)], fill=255, width=mm(0.7))
gm = (np.array(grid) > 127) & ~mimask & ~great & ~small & ~occupied & ~frame_zone
eng_mask(gm, 0.9)

# ------------------------------------------------------------------- trees
rng = np.random.default_rng(19)
trees = Image.new('L', (W, H), 0); td3 = ImageDraw.Draw(trees)
def pine(x, y, s):
    td3.polygon([(x, y - s * 1.15), (x - s * 0.62, y - s * 0.25), (x + s * 0.62, y - s * 0.25)], fill=255)
    td3.polygon([(x, y - s * 0.75), (x - s * 0.8, y + s * 0.35), (x + s * 0.8, y + s * 0.35)], fill=255)
    td3.rectangle([x - s * 0.12, y + s * 0.35, x + s * 0.12, y + s * 0.62], fill=255)
cand_land = (~great) & (~small) & (~frame_zone) & (~occupied)
land_only = cand_land & ((depth == L_LAND) | mimask)
avail = np.argwhere(land_only[::4, ::4])
picks = avail[rng.choice(len(avail), size=4200, replace=False)]
placed = 0
occ_soft = occupied | great | small | frame_zone
for py, px_ in picks:
    y, x = py * 4, px_ * 4
    s = mm(2.6 + 1.6 * rng.random())
    if y - s * 1.3 < 0 or y + s < 0: continue
    y0c, y1c, x0c, x1c = int(y - s * 1.3), int(y + s * 0.8), int(x - s), int(x + s)
    if y0c < 0 or x0c < 0 or y1c >= H or x1c >= W: continue
    if occ_soft[y0c:y1c, x0c:x1c].any(): continue
    if not land_only[y0c:y1c, x0c:x1c].all(): continue
    pine(x, y, s)
    occ_soft[y0c - mm(1):y1c + mm(1), x0c - mm(1):x1c + mm(1)] = True
    placed += 1
    if placed >= 260: break
tm = np.array(trees) > 127
eng_mask(tm, 1.2)

# ----------------------------------------------------------------- compass
comp = Image.new('L', (W, H), 0); cd_ = ImageDraw.Draw(comp)
ccx2, ccy2 = to_px(-79.6, 47.6)
cr = mm(20)
cd_.ellipse([ccx2 - cr, ccy2 - cr, ccx2 + cr, ccy2 + cr], outline=255, width=mm(1.0))
cd_.ellipse([ccx2 - cr * 0.68, ccy2 - cr * 0.68, ccx2 + cr * 0.68, ccy2 + cr * 0.68],
            outline=255, width=mm(0.7))
for i in range(8):
    a = math.pi / 4 * i
    L = cr * (0.92 if i % 2 == 0 else 0.58)
    tip = (ccx2 + L * math.sin(a), ccy2 - L * math.cos(a))
    wv = mm(2.2 if i % 2 == 0 else 1.5)
    cd_.polygon([tip, (ccx2 + wv * math.sin(a + math.pi / 2), ccy2 - wv * math.cos(a + math.pi / 2)),
                 (ccx2 + wv * math.sin(a - math.pi / 2), ccy2 - wv * math.cos(a - math.pi / 2))], fill=255)
cm = np.array(comp) > 127
for ch, dxy in [('N', (0, -1)), ('E', (1, 0)), ('S', (0, 1)), ('W', (-1, 0))]:
    m = stamp_text(ch, ccx2 + dxy[0] * (cr + mm(5)), ccy2 + dxy[1] * (cr + mm(5)), 6.0)
    cm |= m
cm &= ~occupied
eng_mask(cm, 1.3); occupied |= cm

# ------------------------------------------------- frame ornament + corners
orn = Image.new('L', (W, H), 0); od = ImageDraw.Draw(orn)
# bead grooves on rims
for off in (2.2, 13.8):
    o = mm(off)
    od.rectangle([o, o, W - o, H - o], outline=255, width=mm(0.9))
# S-scroll repeating pattern inside channel (as engraved curls)
def scroll_run(x0, y0, x1, y1, horiz=True):
    length = (x1 - x0) if horiz else (y1 - y0)
    n = int(length / mm(24))
    for i in range(n):
        t = x0 + (i + 0.5) * length / n if horiz else y0 + (i + 0.5) * length / n
        cxx = t if horiz else (x0 + x1) / 2
        cyy = (y0 + y1) / 2 if horiz else t
        r1 = mm(4.2)
        if horiz:
            od.arc([cxx - r1 * 2, cyy - r1, cxx, cyy + r1], 90, 360, fill=255, width=mm(1.0))
            od.arc([cxx, cyy - r1, cxx + r1 * 2, cyy + r1], 270, 180, fill=255, width=mm(1.0))
        else:
            od.arc([cxx - r1, cyy - r1 * 2, cxx + r1, cyy], 0, 270, fill=255, width=mm(1.0))
            od.arc([cxx - r1, cyy, cxx + r1, cyy + r1 * 2], 180, 90, fill=255, width=mm(1.0))
CH0, CH1 = mm(4.5), mm(12.5)
scroll_run(mm(30), CH0, W - mm(30), CH1, True)
scroll_run(mm(30), H - CH1, W - mm(30), H - CH0, True)
scroll_run(CH0, mm(30), CH1, H - mm(30), False)
scroll_run(W - CH1, mm(30), W - CH0, H - mm(30), False)
om = (np.array(orn) > 127)
om &= ~plates_m
eng_mask(om, 1.2)

# corner + mid-edge baseballs: domes in the channel with stitch engraving
corner_balls = [(mm(13), mm(13)), (W - mm(13), mm(13)), (mm(13), H - mm(13)),
                (W - mm(13), H - mm(13)), (W / 2, H - mm(9))]
stitch = Image.new('L', (W, H), 0); st = ImageDraw.Draw(stitch)
for bxc, byc in corner_balls:
    br = mm(8.5)
    ys, xs_ = np.mgrid[int(byc - br):int(byc + br + 1), int(bxc - br):int(bxc + br + 1)]
    rr = np.sqrt((xs_ - bxc) ** 2 + (ys - byc) ** 2) / br
    inside = (rr <= 1.0) & (ys >= 0) & (ys < H) & (xs_ >= 0) & (xs_ < W)
    cap = L_CHAN * (1 - np.sqrt(np.clip(1 - rr ** 2, 0, 1)))
    ys_c = np.clip(ys, 0, H - 1); xs_c = np.clip(xs_, 0, W - 1)
    cur = depth[ys_c, xs_c]
    newv = np.where(inside, np.minimum(cur, cap), cur)
    depth[ys_c, xs_c] = newv
    surface[ys_c, xs_c] = np.where(inside, newv, surface[ys_c, xs_c])
    for sgn in (-1, 1):
        ac = bxc + sgn * br * 1.5
        st.arc([ac - br, byc - br, ac + br, byc + br],
               100 if sgn > 0 else -80, 260 if sgn > 0 else 80, fill=255, width=mm(0.8))
sm_ = np.array(stitch) > 127
eng_mask(sm_, 0.9)
# stitches on crest baseballs too
stitch2 = Image.new('L', (W, H), 0); st2 = ImageDraw.Draw(stitch2)
for bxc, byc, br in BALLS:
    for sgn in (-1, 1):
        ac = bxc + sgn * br * 1.5
        st2.arc([ac - br, byc - br, ac + br, byc + br],
                100 if sgn > 0 else -80, 260 if sgn > 0 else 80, fill=255, width=mm(0.8))
eng_mask((np.array(stitch2) > 127), 0.9)

# shield rim groove + banner border groove
rimg = Image.new('L', (W, H), 0); rg = ImageDraw.Draw(rimg)
rg.polygon(shield_path(CCX, CCY, mm(SH_W / 2 - 1.2), mm(SH_H / 2 - 1.2)), outline=255, width=mm(1.0))
rg.rounded_rectangle([bx0 + mm(1.2), by0 + mm(1.2), bx1 - mm(1.2), by1 - mm(1.2)],
                     radius=mm(3.5), outline=255, width=mm(1.0))
rg.rounded_rectangle([ex0 + mm(1.0), ey0 + mm(1.0), ex1 - mm(1.0), ey1 - mm(1.0)],
                     radius=mm(2.5), outline=255, width=mm(0.8))
rmg = (np.array(rimg) > 127) & (surface < 0.1) & ~Dmask & ~tiger_m & ~head_m
eng_mask(rmg, 1.1)

# --------------------------------------------------------- apply engraving
final_eng = np.zeros((H, W), dtype=np.float32)
for mk, amt in eng:
    final_eng = np.where(mk, np.maximum(final_eng, amt), final_eng)
depth = np.where(final_eng > 0, np.maximum(depth, surface + final_eng), depth)
np.save('levels.npy', surface)

# ------------------------------------------------------------------ output
depth = np.clip(depth, 0, MAXD)
gray = np.round(255 * (1 - depth / MAXD)).astype(np.uint8)
Image.fromarray(gray).save('david_lakes_depth.png')

hmap = MAXD - depth
gx, gy = np.gradient(gaussian_filter(hmap, 1.2))
nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
shade = np.clip((gx * 0.5 + gy * 0.6 + 0.63) * nz, 0, 1)
t = depth / MAXD
base = np.stack([210 - 88 * t, 172 - 92 * t, 130 - 84 * t], axis=-1)
img = np.clip(base * (0.55 + 0.55 * shade)[..., None], 0, 255).astype(np.uint8)
Image.fromarray(img).save('david_lakes_preview.png')
print('trees placed:', placed)
print('depth range:', depth.min(), depth.max())
