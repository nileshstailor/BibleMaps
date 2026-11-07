"""Topology-preserving vectorisation of the cleaned plate label map.
Shared boundaries are extracted once as arcs, smoothed once, and reused by both neighbours,
so kingdoms neither overlap nor leave gaps."""
import json, math
import numpy as np, cv2
from scipy import ndimage as ndi

ROOT = '/Users/nileshtailor/CursorApps/BibleMaps'
CLASSES = ['bg', 'water', 'israel', 'judah', 'philistia', 'aram', 'phoenicia', 'ammon', 'moab', 'edom']
CID = {c: i for i, c in enumerate(CLASSES)}
reg = np.load('/tmp/labels.npy').astype(np.int16)
H, W = reg.shape

z = np.load('/tmp/kingdom_georef.npz'); cl = z['coef_lon']; ca = z['coef_lat']
Aff = np.array([[cl[0], cl[1]], [ca[0], ca[1]]]); off = np.array([cl[2], ca[2]])
Ainv = np.linalg.inv(Aff)

def px2ll(x, y):
    return (cl[0] * x + cl[1] * y + cl[2], ca[0] * x + ca[1] * y + ca[2])

def ll2px(lon, lat):
    v = Ainv @ (np.array([lon, lat]) - off)
    return v[0], v[1]

# --- 1) canvas with room for the northern extension (plate is cropped at ~34.0N)
lbl = reg.copy()
EXT = 330
canvas = np.zeros((H + EXT, W), np.int16)
canvas[EXT:] = lbl

def paint(poly_ll, cid):
    pts = np.array([ll2px(lo, la) for lo, la in poly_ll])
    pts[:, 1] += EXT
    cv2.fillPoly(canvas, [np.round(pts).astype(np.int32)], int(cid))

top_lat = px2ll(0, 0)[1]  # latitude of the plate's top edge
row0 = lbl[0]
ph_cols = np.where(row0 == CID['phoenicia'])[0]
ar_cols = np.where(row0 == CID['aram'])[0]
coast_lon = px2ll(ph_cols.min(), 0)[0]
ph_in_lon = px2ll(ph_cols.max(), 0)[0]
ar_east_lon = px2ll(ar_cols.max(), 0)[0]
print(f'top edge lat={top_lat:.3f} coast={coast_lon:.3f} phoen/aram={ph_in_lon:.3f} aram east={ar_east_lon:.3f}')

# Phoenician coast north of the frame: start on the plate's coast, bend east to the real coast
# (Jounieh/Byblos/Batroun/Tripoli), stop around 34.5N.
coast = [(coast_lon, top_lat - 0.03), (max(coast_lon, 35.60) + 0.02, 34.06), (35.645, 34.14), (35.66, 34.22),
         (35.70, 34.30), (35.78, 34.38), (35.85, 34.45), (35.90, 34.50)]
width = ph_in_lon - coast_lon
inland = [(lo + width, la) for lo, la in coast]
inland[0] = (ph_in_lon, top_lat - 0.03)
# rounded cap on the top
cap = []
cx, cy = (coast[-1][0] + inland[-1][0]) / 2, 34.50
rx = width / 2; ry = 0.05
for t in np.linspace(math.pi, 0, 9)[1:-1]:
    cap.append((cx + rx * math.cos(t), cy + ry * math.sin(t)))
phoen_ext = coast + cap + inland[::-1]
paint(phoen_ext, CID['phoenicia'])

# Aram: from the Phoenician inland edge east to the plate's right edge, north to 34.5N,
# with a rounded north-east corner.
NE_R = 0.22
corner = []
for t in np.linspace(math.pi / 2, 0, 10):
    corner.append((ar_east_lon - NE_R + NE_R * math.cos(t), 34.50 - NE_R + NE_R * math.sin(t)))
aram_ext = inland + [(inland[-1][0] + 0.02, 34.50)] + corner + [(ar_east_lon, top_lat - 0.03)]
paint(aram_ext, CID['aram'])

# --- 2b) snap seaward edges to the real Mediterranean coastline. The plate's coast is schematic
# (4-6 km inland of the real shore between Gaza and Tyre); inland borders stay as traced.
COAST = [  # (lon, lat), south -> north
    (33.80, 31.13), (34.00, 31.19), (34.12, 31.24), (34.24, 31.32), (34.33, 31.42), (34.43, 31.52),
    (34.50, 31.60), (34.55, 31.67), (34.60, 31.76), (34.63, 31.80), (34.68, 31.88), (34.71, 31.95),
    (34.74, 32.02), (34.75, 32.06), (34.77, 32.10), (34.80, 32.17), (34.83, 32.26), (34.85, 32.33),
    (34.87, 32.42), (34.89, 32.50), (34.92, 32.62), (34.94, 32.70), (34.95, 32.78), (34.96, 32.83),
    (35.00, 32.82), (35.03, 32.81), (35.07, 32.85), (35.065, 32.92), (35.085, 32.97), (35.09, 33.01), (35.10, 33.09),
    (35.13, 33.12), (35.19, 33.21), (35.19, 33.27), (35.23, 33.35), (35.29, 33.45), (35.34, 33.52),
    (35.37, 33.56), (35.41, 33.66), (35.44, 33.72), (35.47, 33.83), (35.48, 33.90), (35.52, 33.91),
    (35.58, 33.92), (35.60, 33.95), (35.63, 33.98), (35.64, 34.06), (35.65, 34.12), (35.66, 34.20),
    (35.66, 34.25), (35.72, 34.32), (35.78, 34.38), (35.83, 34.44), (35.90, 34.47), (35.96, 34.52),
    (35.98, 34.60), (35.98, 34.70),
]
sea_poly = [(32.0, 30.5)] + COAST + [(32.0, 35.0)]
sea_pts = np.array([ll2px(lo, la) for lo, la in sea_poly]); sea_pts[:, 1] += EXT
sea_px = cv2.fillPoly(np.zeros(canvas.shape, np.uint8), [np.round(sea_pts).astype(np.int32)], 1).astype(bool)

water_cc_n, water_cc = cv2.connectedComponents((canvas == CID['water']).astype(np.uint8), connectivity=4)
areas = np.bincount(water_cc.ravel()); areas[0] = 0
med = water_cc == areas.argmax()                      # Mediterranean as drawn on the plate
kingdom = canvas >= 2
dist_k = cv2.distanceTransform((~kingdom).astype(np.uint8), cv2.DIST_L2, 5)
ext_region = np.zeros(canvas.shape, bool); ext_region[:EXT + 5] = True
to_fill = (~sea_px) & (med | (ext_region & (canvas == 0) & (dist_k < 90)))
canvas[sea_px] = CID['water']
cand = ~(to_fill | (canvas == CID['water']))
idx = ndi.distance_transform_edt(~cand, return_distances=False, return_indices=True)
filled = canvas[idx[0], idx[1]]
canvas[to_fill] = filled[to_fill]
print('coast snap: trimmed to sea px', int((sea_px & kingdom).sum()), ' land filled px', int(to_fill.sum()))

# --- 2c) anchor towns the plate places just inside Israel but whose true coordinates fall a few km
# across the traced line (plate dots are slightly displaced).
ANCHORS = {'israel': [(35.6525, 33.2486, 12, 12), (35.221, 31.9306, 30, 13)]}  # Dan, Bethel (wide, shallow)
for kid, pts in ANCHORS.items():
    for lo, la, rx, ry in pts:
        x, y = ll2px(lo, la)
        cv2.ellipse(canvas, (int(round(x)), int(round(y + EXT))), (rx, ry), 0, 0, 360, int(CID[kid]), -1)
# Jericho and Gilgal are drawn north of the Israel/Judah line on the plate; the plate's Jericho dot
# sits ~10 km NE of the real tell, so bend the line south of both towns down to the Dead Sea tip.
paint([(35.40, 31.945), (35.58, 31.945), (35.58, 31.83), (35.53, 31.81), (35.49, 31.83),
       (35.45, 31.84), (35.41, 31.88)], CID['israel'])

# --- 2d) water and background are both "none"; fill small trapped islands with the nearest kingdom
canvas[canvas == CID['water']] = 0
none_mask = (canvas == 0).astype(np.uint8)
n, cc, stats, _ = cv2.connectedComponentsWithStats(none_mask, connectivity=4)
small = np.zeros_like(none_mask, bool)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] < 15000:
        small |= cc == i
if small.any():
    idx = ndi.distance_transform_edt(small, return_distances=False, return_indices=True)
    canvas = canvas[idx[0], idx[1]]
    print('filled trapped none-islands px:', int(small.sum()))

# --- 3) regularise the whole canvas so plate/extension seams and pixel noise are smoothed
K = len(CLASSES)
onehot = np.zeros((K, canvas.shape[0], canvas.shape[1]), np.float32)
for k in range(K):
    m = (canvas == k).astype(np.float32)
    if m.any():
        onehot[k] = cv2.GaussianBlur(m, (0, 0), 6)
canvas = onehot.argmax(0).astype(np.int16)
# keep only the main component for each kingdom
for k in range(2, K):
    m = (canvas == k).astype(np.uint8)
    n, cc, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    if n > 2:
        keep = 1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())
        canvas[(cc != keep) & (cc != 0)] = 0
np.save('/tmp/canvas.npy', canvas)

# --- 4) arc extraction on the corner grid
P = np.pad(canvas, 1, constant_values=0)
Hp, Wp = P.shape
hE = np.zeros((Hp + 1, Wp), bool)   # hE[r, c]: edge between pixel rows r-1 and r at column c
vE = np.zeros((Hp, Wp + 1), bool)   # vE[r, c]: edge between pixel cols c-1 and c at row r
hE[1:Hp, :] = P[:-1, :] != P[1:, :]
vE[:, 1:Wp] = P[:, :-1] != P[:, 1:]

deg = np.zeros((Hp + 1, Wp + 1), np.int8)
deg[:, :-1] += hE          # edge to the right of corner (r,c)
deg[:, 1:] += hE           # edge to the left
deg[:-1, :] += vE          # edge below
deg[1:, :] += vE           # edge above
junction = deg >= 3
print('boundary edges:', int(hE.sum() + vE.sum()), 'junctions:', int(junction.sum()))

visited_h = np.zeros_like(hE); visited_v = np.zeros_like(vE)

def incident(r, c):
    """Edges incident to corner (r,c) as (kind, er, ec, (nr, nc))."""
    out = []
    if c < Wp and hE[r, c]: out.append(('h', r, c, (r, c + 1)))
    if c > 0 and hE[r, c - 1]: out.append(('h', r, c - 1, (r, c - 1)))
    if r < Hp and vE[r, c]: out.append(('v', r, c, (r + 1, c)))
    if r > 0 and vE[r - 1, c]: out.append(('v', r - 1, c, (r - 1, c)))
    return out

def side_labels(kind, er, ec, frm, to):
    """(left, right) labels when walking the edge from corner frm to corner to."""
    if kind == 'h':
        above = P[er - 1, ec] if er - 1 >= 0 else 0
        below = P[er, ec] if er < Hp else 0
        return (above, below) if to[1] > frm[1] else (below, above)
    else:
        left_px = P[er, ec - 1] if ec - 1 >= 0 else 0
        right_px = P[er, ec] if ec < Wp else 0
        # walking south (row increasing): left hand is east (right_px)
        return (right_px, left_px) if to[0] > frm[0] else (left_px, right_px)

def mark(kind, er, ec):
    if kind == 'h': visited_h[er, ec] = True
    else: visited_v[er, ec] = True

def is_visited(kind, er, ec):
    return visited_h[er, ec] if kind == 'h' else visited_v[er, ec]

arcs = []  # dict(pts=[(r,c)...], left, right, closed)

def walk(start, first_edge):
    kind, er, ec, nxt = first_edge
    pts = [start]
    left, right = side_labels(kind, er, ec, start, nxt)
    mark(kind, er, ec)
    cur, prev_edge = nxt, (kind, er, ec)
    pts.append(cur)
    while not junction[cur] and cur != start:
        cands = [e for e in incident(*cur) if (e[0], e[1], e[2]) != prev_edge]
        if len(cands) != 1:
            break
        e = cands[0]
        mark(e[0], e[1], e[2])
        prev_edge = (e[0], e[1], e[2])
        cur = e[3]
        pts.append(cur)
    return dict(pts=pts, left=int(left), right=int(right), closed=(cur == start and not junction[start]))

jr, jc = np.where(junction)
for r, c in zip(jr, jc):
    for e in incident(r, c):
        if not is_visited(e[0], e[1], e[2]):
            arcs.append(walk((r, c), e))
# remaining closed loops
for kind, E, V in (('h', hE, visited_h), ('v', vE, visited_v)):
    rem = np.argwhere(E & ~V)
    for er, ec in rem:
        if V[er, ec]: continue
        start = (er, ec)
        edge = (kind, er, ec, (er, ec + 1) if kind == 'h' else (er + 1, ec))
        arcs.append(walk(start, edge))
print('arcs:', len(arcs), 'closed loops:', sum(a['closed'] for a in arcs))

# --- 5) smooth each arc once (DP -> Chaikin -> light DP), endpoints pinned
def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    dmax, idx = -1, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if L2 == 0:
            d = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d > dmax: dmax, idx = d, i
    if dmax > eps:
        return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [a, b]

def chaikin_open(pts, it):
    for _ in range(it):
        if len(pts) < 3: return pts
        out = [pts[0]]
        for i in range(len(pts) - 1):
            p, q = pts[i], pts[i + 1]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        out.append(pts[-1])
        pts = out
    return pts

def chaikin_closed(pts, it):
    for _ in range(it):
        out = []
        n = len(pts)
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % n]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        pts = out
    return pts

EPS1, CHAIKIN_IT, EPS2 = 2.0, 3, 0.3
for a in arcs:
    # corner (r,c) of padded grid -> plate pixel-centre coords (x, y) with the extension offset
    xy = [(c - 1.5, r - 1.5 - EXT) for r, c in a['pts']]
    if a['closed']:
        core = dp(xy[:-1] + [xy[0]], EPS1)[:-1]
        sm = chaikin_closed(core, CHAIKIN_IT)
        sm = dp(sm + [sm[0]], EPS2)[:-1]
    else:
        core = dp(xy, EPS1)
        sm = chaikin_open(core, CHAIKIN_IT)
        sm = dp(sm, EPS2)
    a['xy'] = sm

# --- 6) assemble rings per kingdom
def ring_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s / 2

features = []
prev = json.load(open(f'{ROOT}/data/kingdoms.json'))
prev_props = {f['properties']['id']: f['properties'] for f in prev['features']}
order = ['israel', 'judah', 'philistia', 'aram', 'phoenicia', 'ammon', 'moab', 'edom']

def inside(lon, lat, ring):
    x, y = lon, lat; n = len(ring); odd = False; j = n - 1
    for i in range(n):
        xi, yi = ring[i]; xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi): odd = not odd
        j = i
    return odd

for kid in order:
    k = CID[kid]
    mine = []
    for a in arcs:
        if a['left'] == k:
            mine.append((a['pts'][0], a['pts'][-1], a['xy'], a['closed']))
        elif a['right'] == k:
            mine.append((a['pts'][-1], a['pts'][0], a['xy'][::-1], a['closed']))
    rings = []
    used = [False] * len(mine)
    by_start = {}
    for i, (s, e, xy, closed) in enumerate(mine):
        by_start.setdefault(s, []).append(i)
    for i in range(len(mine)):
        if used[i]: continue
        s0, e, xy, closed = mine[i]
        used[i] = True
        if closed:
            rings.append(list(xy)); continue
        ring = list(xy)
        cur = e
        guard = 0
        while cur != s0 and guard < 10000:
            guard += 1
            nxt = None
            for j in by_start.get(cur, []):
                if not used[j]: nxt = j; break
            if nxt is None: break
            used[nxt] = True
            ring.extend(mine[nxt][2][1:])
            cur = mine[nxt][1]
        rings.append(ring)
    rings.sort(key=lambda r: -abs(ring_area(r)))
    ll_rings = []
    for r in rings:
        ll = [px2ll(x, y) for x, y in r]
        if ring_area(ll) < 0: ll = ll[::-1]  # exterior CCW in lon/lat
        if ll[0] != ll[-1]: ll.append(ll[0])
        ll_rings.append([[round(lo, 5), round(la, 5)] for lo, la in ll])
    if len(ll_rings) > 1:
        print(f'{kid}: {len(ll_rings)} rings (areas {[round(abs(ring_area(r)),5) for r in ll_rings]}) - keeping largest')
    ext = ll_rings[0]
    props = dict(prev_props[kid])
    if not inside(props['labelLng'], props['labelLat'], ext):
        m = (canvas == k).astype(np.uint8)
        dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
        y, x = np.unravel_index(dt.argmax(), dt.shape)
        lo, la = px2ll(x, y - EXT)
        props['labelLng'], props['labelLat'] = round(lo, 4), round(la, 4)
        print(f'{kid}: moved label to {props["labelLng"]},{props["labelLat"]}')
    features.append({'type': 'Feature', 'properties': props,
                     'geometry': {'type': 'Polygon', 'coordinates': [ext]}})
    print(f'{kid:10s} verts={len(ext)}')

meta = dict(prev['meta'])
meta['georef'] = ('Affine georeference from Sea of Galilee / Dead Sea / coast control points (RMSE ~2 km). '
                  'Negev folded into Judah. Aram and Phoenicia are cropped by the plate frame at ~34.0N and '
                  'are extended north to ~34.5N (Phoenicia along the Lebanese coast). labelLng/labelLat drive the subtle map labels.')
meta['smoothing'] = ('Colour-classified plate pixels, Gaussian-regularised label map, shared boundary arcs extracted once '
                     'and smoothed with Douglas-Peucker + Chaikin so adjacent kingdoms share exact borders (no gaps/overlaps).')
out = {'type': 'FeatureCollection', 'meta': meta, 'features': features}
json.dump(out, open(f'{ROOT}/data/kingdoms.json', 'w'), indent=2)
open(f'{ROOT}/data/kingdoms.json', 'a').write('\n')
print('wrote kingdoms.json')
