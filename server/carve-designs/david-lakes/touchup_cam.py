#!/usr/bin/env python3
"""Touch-up G-code for the DAVID Great Lakes carve.

Deepens ONLY: Tigers crest detail, compass rose, banner (DAVID + EST. 1989).
Assumes the board is mounted exactly as for the original job:
  XY zero = front-left corner of the 400x330 stock, Z zero = top face.
Image row 0 (top) maps to CNC Y = 330 mm.

Outputs:
  touchup_1_vbit60.nc   60-deg V-bit: centerline re-trace of all engraving
                        in the three zones, to (local surface + 2.3 mm).
  touchup_2_taper16.nc  1/16" tapered flat: banner face + shield field
                        pockets 1.6 -> 3.0 mm, radius-compensated.
"""
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import binary_dilation, binary_erosion
from skimage.morphology import skeletonize

PXMM = 8
W_MM, H_MM = 400.0, 330.0
H, W = 2640, 3200
SAFE_Z = 4.0
V_DEPTH = 2.3          # engraving depth below local surface (was 1.3-1.5)
POCKET_NEW = 3.0       # banner/shield pockets (was 1.6)
V_FEED, V_PLUNGE = 600, 250
P_FEED, P_PLUNGE = 800, 300
STEPOVER = 0.55        # mm, for 1.6mm tip
TIP_R_PX = 7           # 0.8mm+margin in px for radius compensation

levels = np.load('levels.npy')
final_eng = np.load('tu_final_eng.npy')
crest_plate = np.load('tu_crest_plate.npy')
sh_inner = np.load('tu_sh_inner.npy')
Dmask = np.load('tu_Dmask.npy')
head = np.load('tu_head.npy')
face_m = np.load('tu_face_m.npy')
compass = np.load('tu_compass.npy')
banner_plates = np.load('tu_banner_plates.npy')

def disk(r):
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (xx * xx + yy * yy) <= r * r

# zones: crest (plates + shield, dilated 2mm), banner plates, compass
zone = binary_dilation(crest_plate | sh_inner, disk(16))
zone |= binary_dilation(banner_plates, disk(16))
zone |= binary_dilation(compass, disk(8))

vmask = (final_eng > 0) & zone & (levels < 4.0)
print('v-engrave px:', vmask.sum())

def xy_mm(col, row):
    return col / PXMM, H_MM - row / PXMM

# ---------------- skeleton -> polylines ----------------
skel = skeletonize(vmask)
pts = set(map(tuple, np.argwhere(skel)))
NB = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
def neighbors(p):
    return [(p[0]+dy, p[1]+dx) for dy, dx in NB if (p[0]+dy, p[1]+dx) in pts]
deg = {p: len(neighbors(p)) for p in pts}
paths = []
remaining = set(pts)
def walk(start):
    path = [start]
    remaining.discard(start)
    cur, prev = start, None
    while True:
        nxt = [q for q in neighbors(cur) if q in remaining]
        if not nxt:
            break
        # prefer continuing straight
        if prev is not None and len(nxt) > 1:
            dy, dx = cur[0]-prev[0], cur[1]-prev[1]
            nxt.sort(key=lambda q: -( (q[0]-cur[0])*dy + (q[1]-cur[1])*dx ))
        prev, cur = cur, nxt[0]
        remaining.discard(cur)
        path.append(cur)
    return path
# endpoints first, then leftovers (loops)
for p in sorted(pts, key=lambda p: (deg.get(p, 0) != 1,)):
    if p in remaining and (deg.get(p, 0) == 1 or True):
        if p not in remaining: continue
        if deg.get(p, 0) == 1:
            paths.append(walk(p))
while remaining:
    paths.append(walk(next(iter(remaining))))
paths = [p for p in paths if len(p) >= 3]
print('paths:', len(paths))

def rdp(points, eps):
    if len(points) < 3: return points
    p0, p1 = np.array(points[0], float), np.array(points[-1], float)
    d = p1 - p0
    L = np.hypot(*d) or 1.0
    dists = [abs(d[1]*(p[0]-p0[0]) - d[0]*(p[1]-p0[1]))/L for p in points[1:-1]]
    if not dists: return [points[0], points[-1]]
    i = int(np.argmax(dists))
    if dists[i] > eps:
        a = rdp(points[:i+2], eps); b = rdp(points[i+1:], eps)
        return a[:-1] + b
    return [points[0], points[-1]]

import sys
sys.setrecursionlimit(100000)
simp = [rdp(p, 1.2) for p in paths]

def densify(path, step_px=10):
    out = []
    for a, b in zip(path[:-1], path[1:]):
        a = np.array(a, float); b = np.array(b, float)
        n = max(1, int(np.hypot(*(b - a)) / step_px))
        for t in range(n):
            out.append(tuple(a + (b - a) * t / n))
    out.append(tuple(map(float, path[-1])))
    return out

def local_level(row, col):
    r0, r1 = max(0, int(row)-2), min(H, int(row)+3)
    c0, c1 = max(0, int(col)-2), min(W, int(col)+3)
    return float(levels[r0:r1, c0:c1].min())   # shallowest nearby surface

# order paths greedy nearest-neighbor
order, used = [], set()
cur = (0.0, 0.0)
starts = [(p[0], p[-1]) for p in simp]
for _ in range(len(simp)):
    best, bi, flip = None, -1, False
    for i, (s, e) in enumerate(starts):
        if i in used: continue
        ds = (s[0]-cur[0])**2 + (s[1]-cur[1])**2
        de = (e[0]-cur[0])**2 + (e[1]-cur[1])**2
        if best is None or min(ds, de) < best:
            best, bi, flip = min(ds, de), i, de < ds
    used.add(bi)
    p = simp[bi][::-1] if flip else simp[bi]
    order.append(p)
    cur = p[-1]

g1 = ["(touchup pass 1 - 60deg V-bit, deepen engraving to local surface + %.1fmm)" % V_DEPTH,
      "(zero: front-left corner XY, top face Z - SAME as original job)",
      "G21 G90 G94", "G0 Z%.2f" % SAFE_Z, "M3 S11000", "G4 P2"]
cutlen = 0.0
for p in order:
    dp = densify(p)
    x0, y0 = xy_mm(dp[0][1], dp[0][0])
    z0 = -(local_level(dp[0][0], dp[0][1]) + V_DEPTH)
    g1.append("G0 X%.2f Y%.2f" % (x0, y0))
    g1.append("G1 Z%.2f F%d" % (z0, V_PLUNGE))
    lastz = z0
    px, py = x0, y0
    for (r, c) in dp[1:]:
        x, y = xy_mm(c, r)
        z = -(local_level(r, c) + V_DEPTH)
        if abs(z - lastz) > 0.06:
            g1.append("G1 X%.2f Y%.2f Z%.2f F%d" % (x, y, z, V_FEED))
            lastz = z
        else:
            g1.append("G1 X%.2f Y%.2f F%d" % (x, y, V_FEED))
        cutlen += ((x-px)**2 + (y-py)**2) ** 0.5
        px, py = x, y
    g1.append("G0 Z%.2f" % SAFE_Z)
g1 += ["M5", "G0 X0 Y0", "M30"]
open('touchup_1_vbit60.nc', 'w').write('\n'.join(g1) + '\n')
print('vbit file lines:', len(g1), 'cut length m: %.1f' % (cutlen/1000),
      'est min @%d: %.0f' % (V_FEED, cutlen/V_FEED + len(order)*0.05))

# ---------------- pocket deepening (1/16" tapered flat) ----------------
shield_field = sh_inner & ~binary_dilation(Dmask, disk(2)) & ~binary_dilation(head, disk(2))
allowed = face_m | shield_field
toolpos = binary_erosion(allowed, disk(TIP_R_PX))
print('pocket tool-position px:', toolpos.sum())

g2 = ["(touchup pass 2 - 1/16in tapered flat tip, pockets 1.6 -> %.1fmm)" % POCKET_NEW,
      "(banner face around DAVID letters + shield field around D and tiger head)",
      "(zero: front-left corner XY, top face Z - SAME as original job)",
      "G21 G90 G94", "G0 Z%.2f" % SAFE_Z, "M3 S11000", "G4 P2"]
step_px = max(1, int(STEPOVER * PXMM))
plen = 0.0
for zdepth in (2.3, POCKET_NEW):
    g2.append("(pass at Z-%.2f)" % zdepth)
    direction = 1
    for row in range(0, H, step_px):
        cols = np.where(toolpos[row])[0]
        if len(cols) == 0: continue
        # group into runs
        runs = []
        s = cols[0]; prev = cols[0]
        for c in cols[1:]:
            if c > prev + 1:
                runs.append((s, prev)); s = c
            prev = c
        runs.append((s, prev))
        if direction < 0: runs = [(b, a) for a, b in reversed(runs)]
        for a, b in runs:
            xa, ya = xy_mm(a, row); xb, yb = xy_mm(b, row)
            g2.append("G0 X%.2f Y%.2f" % (xa, ya))
            g2.append("G1 Z%.2f F%d" % (-zdepth, P_PLUNGE))
            g2.append("G1 X%.2f F%d" % (xb, P_FEED))
            g2.append("G0 Z%.2f" % SAFE_Z)
            plen += abs(xb - xa)
        direction = -direction
g2 += ["M5", "G0 X0 Y0", "M30"]
open('touchup_2_taper16.nc', 'w').write('\n'.join(g2) + '\n')
print('pocket file lines:', len(g2), 'cut length m: %.1f' % (plen/1000),
      'est min @%d: %.0f' % (P_FEED, plen/P_FEED + 10))
