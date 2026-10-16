#!/usr/bin/env python3
"""Single-tool touch-up: EVERYTHING with the 1/16" tapered (flat 1.6mm tip).

One file, no tool change. Section A re-traces engraved centerlines in the
crest/compass/banner zones at two depths (surface+1.5, +2.3), giving bold
~2mm flat-bottom strokes. Tiny dots (pupils, whiskers) become peck plunges.
Thin decorative border grooves are deliberately skipped (a 2mm cut would
leave fragile ridge walls). Section B deepens the banner-face and shield
pockets 1.6 -> 3.0mm, radius-compensated around the raised letters/D/head.
Zero: front-left corner XY, ORIGINAL top face Z (probe on the frame rim).
"""
import numpy as np
from scipy.ndimage import binary_dilation, binary_erosion, label
from skimage.morphology import skeletonize

PXMM = 8
H_MM = 330.0
H, W = 2640, 3200
SAFE_Z = 4.0
LINE_DEPTHS = (1.5, 2.3)
POCKET_DEPTHS = (2.3, 3.0)
L_FEED, L_PLUNGE = 550, 220
P_FEED, P_PLUNGE = 800, 300
STEPOVER_PX = 4          # 0.5mm
TIP_R_PX = 7

levels = np.load('levels.npy')
final_eng = np.load('tu_final_eng.npy')
crest_plate = np.load('tu_crest_plate.npy')
sh_inner = np.load('tu_sh_inner.npy')
Dmask = np.load('tu_Dmask.npy')
head = np.load('tu_head.npy')
face_m = np.load('tu_face_m.npy')
compass = np.load('tu_compass.npy')
banner_plates = np.load('tu_banner_plates.npy')
rimg = np.load('tu_rimg.npy')

def disk(r):
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (xx * xx + yy * yy) <= r * r

zone = binary_dilation(crest_plate | sh_inner, disk(16))
zone |= binary_dilation(banner_plates, disk(16))
zone |= binary_dilation(compass, disk(8))
vmask = (final_eng > 0) & zone & (levels < 4.0) & ~binary_dilation(rimg, disk(2))
print('line px:', vmask.sum())

def xy_mm(col, row):
    return col / PXMM, H_MM - row / PXMM

def local_level(row, col):
    r0, r1 = max(0, int(row) - 2), min(H, int(row) + 3)
    c0, c1 = max(0, int(col) - 2), min(W, int(col) + 3)
    return float(levels[r0:r1, c0:c1].min())

# tiny isolated blobs -> peck points; the rest -> skeleton paths
lab, n = label(vmask)
sizes = np.bincount(lab.ravel())
pecks, big = [], np.zeros_like(vmask)
for i in range(1, n + 1):
    if sizes[i] < 220:               # < ~3.4 mm^2: treat as a dot
        ys, xs = np.where(lab == i)
        pecks.append((ys.mean(), xs.mean()))
    else:
        big |= (lab == i)
print('pecks:', len(pecks))

skel = skeletonize(big)
pts = set(map(tuple, np.argwhere(skel)))
NB = [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
def neighbors(p):
    return [(p[0]+a, p[1]+b) for a, b in NB if (p[0]+a, p[1]+b) in pts]
deg = {p: len(neighbors(p)) for p in pts}
remaining = set(pts)
def walk(start):
    path = [start]; remaining.discard(start)
    cur, prev = start, None
    while True:
        nxt = [q for q in neighbors(cur) if q in remaining]
        if not nxt: break
        if prev is not None and len(nxt) > 1:
            dy, dx = cur[0]-prev[0], cur[1]-prev[1]
            nxt.sort(key=lambda q: -((q[0]-cur[0])*dy + (q[1]-cur[1])*dx))
        prev, cur = cur, nxt[0]
        remaining.discard(cur); path.append(cur)
    return path
paths = []
for p in sorted(pts, key=lambda p: deg.get(p, 0) != 1):
    if p in remaining and deg.get(p, 0) == 1:
        paths.append(walk(p))
while remaining:
    paths.append(walk(next(iter(remaining))))
paths = [p for p in paths if len(p) >= 3]
print('paths:', len(paths))

import sys
sys.setrecursionlimit(100000)
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
simp = [rdp(p, 1.2) for p in paths]

def densify(path, step_px=10):
    out = []
    for a, b in zip(path[:-1], path[1:]):
        a = np.array(a, float); b = np.array(b, float)
        nseg = max(1, int(np.hypot(*(b - a)) / step_px))
        for t in range(nseg):
            out.append(tuple(a + (b - a) * t / nseg))
    out.append(tuple(map(float, path[-1])))
    return out

# order greedily
order, used, cur = [], set(), (0.0, 0.0)
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
    order.append(simp[bi][::-1] if flip else simp[bi])
    cur = order[-1][-1]

g = ["(SINGLE-TOOL touchup - 1/16in tapered spiral, flat tip)",
     "(A: bold re-engrave of crest/compass/banner lines, 2 depth passes)",
     "(B: deepen banner-face + shield pockets 1.6 -> 3.0mm, 2 depth passes)",
     "(zero: front-left corner XY, ORIGINAL top face Z - probe on frame rim)",
     "G21 G90 G94", "G0 Z%.2f" % SAFE_Z, "M3 S11000", "G4 P2",
     "(--- section A: line work ---)"]
cutlen = 0.0
def emit_pass(dp, dsub, feed):
    global cutlen
    out = []
    px, py = None, None
    lastz = None
    for (r, c) in dp:
        x, y = xy_mm(c, r)
        z = -(local_level(r, c) + dsub)
        if px is None:
            out.append("G1 Z%.2f F%d" % (z, L_PLUNGE))
        elif lastz is None or abs(z - lastz) > 0.06:
            out.append("G1 X%.2f Y%.2f Z%.2f F%d" % (x, y, z, feed))
        else:
            out.append("G1 X%.2f Y%.2f F%d" % (x, y, feed))
        if px is not None:
            cutlen += ((x-px)**2 + (y-py)**2) ** 0.5
        px, py, lastz = x, y, z
    return out

for p in order:
    dp = densify(p)
    x0, y0 = xy_mm(dp[0][1], dp[0][0])
    g.append("G0 X%.2f Y%.2f" % (x0, y0))
    g += emit_pass(dp, LINE_DEPTHS[0], L_FEED)       # forward, shallow
    g += emit_pass(dp[::-1], LINE_DEPTHS[1], L_FEED) # back, full depth
    g.append("G0 Z%.2f" % SAFE_Z)
for (r, c) in pecks:
    x, y = xy_mm(c, r)
    z = -(local_level(r, c) + LINE_DEPTHS[1])
    g.append("G0 X%.2f Y%.2f" % (x, y))
    g.append("G1 Z%.2f F%d" % (z, L_PLUNGE))
    g.append("G0 Z%.2f" % SAFE_Z)
print('line cut length m: %.1f' % (cutlen / 1000))

# ---------------- section C: roads, city dots, trees ----------------
g.append("(--- section C: roads, city dots, pines - single pass ---)")
roads = np.load('tu_roads.npy'); dots = np.load('tu_dots.npy'); trees = np.load('tu_trees.npy')
cmask = roads | trees
lab2, n2 = label(cmask)
sizes2 = np.bincount(lab2.ravel())
pecks2, big2 = [], np.zeros_like(cmask)
for i in range(1, n2 + 1):
    if sizes2[i] < 160:
        ys, xs = np.where(lab2 == i)
        pecks2.append((ys.mean(), xs.mean()))
    else:
        big2 |= (lab2 == i)
skel2 = skeletonize(big2)
pts.clear()
pts.update(map(tuple, np.argwhere(skel2)))
deg2 = {p: len(neighbors(p)) for p in pts}
remaining.clear(); remaining.update(pts)
paths2 = []
for p in sorted(pts, key=lambda p: deg2.get(p, 0) != 1):
    if p in remaining and deg2.get(p, 0) == 1:
        paths2.append(walk(p))
while remaining:
    paths2.append(walk(next(iter(remaining))))
paths2 = [p for p in paths2 if len(p) >= 3]
simp2 = [rdp(p, 1.2) for p in paths2]
order2, used2, cur2 = [], set(), (0.0, 0.0)
starts2 = [(p[0], p[-1]) for p in simp2]
for _ in range(len(simp2)):
    best, bi, flip = None, -1, False
    for i, (s, e) in enumerate(starts2):
        if i in used2: continue
        ds = (s[0]-cur2[0])**2 + (s[1]-cur2[1])**2
        de = (e[0]-cur2[0])**2 + (e[1]-cur2[1])**2
        if best is None or min(ds, de) < best:
            best, bi, flip = min(ds, de), i, de < ds
    used2.add(bi)
    order2.append(simp2[bi][::-1] if flip else simp2[bi])
    cur2 = order2[-1][-1]
print('C paths:', len(order2), 'C pecks:', len(pecks2))
for p in order2:
    dp = densify(p)
    x0, y0 = xy_mm(dp[0][1], dp[0][0])
    g.append("G0 X%.2f Y%.2f" % (x0, y0))
    g += emit_pass(dp, 1.9, L_FEED)
    g.append("G0 Z%.2f" % SAFE_Z)
for (r, c) in pecks2:
    x, y = xy_mm(c, r)
    g.append("G0 X%.2f Y%.2f" % (x, y))
    g.append("G1 Z%.2f F%d" % (-(local_level(r, c) + 1.9), L_PLUNGE))
    g.append("G0 Z%.2f" % SAFE_Z)
# city dots: one peck at each dot centroid
labd, nd = label(dots)
for i in range(1, nd + 1):
    ys, xs = np.where(labd == i)
    x, y = xy_mm(xs.mean(), ys.mean())
    g.append("G0 X%.2f Y%.2f" % (x, y))
    g.append("G1 Z%.2f F%d" % (-(local_level(ys.mean(), xs.mean()) + 2.0), L_PLUNGE))
    g.append("G0 Z%.2f" % SAFE_Z)

# ---------------- section B: pockets ----------------
g.append("(--- section B: pocket deepening ---)")
shield_field = sh_inner & ~binary_dilation(Dmask, disk(2)) & ~binary_dilation(head, disk(2))
toolpos = binary_erosion(face_m | shield_field, disk(TIP_R_PX))
plen = 0.0
for zdepth in POCKET_DEPTHS:
    g.append("(pocket pass Z-%.2f)" % zdepth)
    direction = 1
    for row in range(0, H, STEPOVER_PX):
        cols = np.where(toolpos[row])[0]
        if len(cols) == 0: continue
        runs, s, prev = [], cols[0], cols[0]
        for c in cols[1:]:
            if c > prev + 1:
                runs.append((s, prev)); s = c
            prev = c
        runs.append((s, prev))
        if direction < 0: runs = [(b, a) for a, b in reversed(runs)]
        for a, b in runs:
            xa, ya = xy_mm(a, row); xb, _ = xy_mm(b, row)
            g.append("G0 X%.2f Y%.2f" % (xa, ya))
            g.append("G1 Z%.2f F%d" % (-zdepth, P_PLUNGE))
            g.append("G1 X%.2f F%d" % (xb, P_FEED))
            g.append("G0 Z%.2f" % SAFE_Z)
            plen += abs(xb - xa)
        direction = -direction
# ---------------- section D: contour edge-smoothing pass ----------------
from skimage.measure import find_contours
g.append("(--- section D: outline trace of every wall to smooth edges ---)")
CONTOUR_R = 6            # 0.75mm offset -> light 0.05mm skim of each wall
lvl_targets = [1.8, 2.0, 4.2, 6.4, 8.6, 10.8]
# pockets were just deepened to 3.0: trace them at 3.0 (cleans letter edges too)
pocket_zone = face_m | shield_field
clen = 0.0
def emit_contours(region, zval):
    global clen
    er = binary_erosion(region, disk(CONTOUR_R))
    if not er.any(): return
    for cont in find_contours(er.astype(float), 0.5):
        if len(cont) < 8: continue
        raw = [tuple(p) for p in cont[::2]]
        # closed loop: split at the farthest point so RDP doesn't collapse it
        p0 = np.array(raw[0], float)
        k = int(np.argmax([np.hypot(*(np.array(q, float) - p0)) for q in raw]))
        if k < 2: continue
        cpts = rdp(raw[:k + 1], 0.8)[:-1] + rdp(raw[k:], 0.8)
        if len(cpts) < 4: continue
        x0, y0 = xy_mm(cpts[0][1], cpts[0][0])
        g.append("G0 X%.2f Y%.2f" % (x0, y0))
        g.append("G1 Z%.2f F%d" % (-zval, P_PLUNGE))
        px, py = x0, y0
        for (r, c) in cpts[1:]:
            x, y = xy_mm(c, r)
            g.append("G1 X%.2f Y%.2f F%d" % (x, y, P_FEED))
            clen += ((x-px)**2 + (y-py)**2) ** 0.5
            px, py = x, y
        # close the loop
        g.append("G1 X%.2f Y%.2f F%d" % (x0, y0, P_FEED))
        g.append("G0 Z%.2f" % SAFE_Z)
for v in lvl_targets:
    region = levels >= (v - 0.05)
    emit_contours(region & ~pocket_zone, v)
emit_contours(pocket_zone, 3.0)
print('contour length m: %.1f' % (clen / 1000))

g += ["M5", "G0 X0 Y0", "M30"]
open('touchup_taper16_all.nc', 'w').write('\n'.join(g) + '\n')
print('pocket cut length m: %.1f' % (plen / 1000))
print('file lines:', len(g),
      'est total min: %.0f' % (cutlen/L_FEED + plen/P_FEED + len(order)*0.08 + len(pecks)*0.05 + 12))
