#!/usr/bin/env python3
"""Precision-trace a shared-frame Israel atlas plate into smoothed GeoJSON overlays.

Reuses the Israel-frame affine georeference (scripts/georef/israel-frame.npz) and the
same topology-preserving arc pipeline used for the divided kingdom.

Usage:
  python3 scripts/digitize/trace_era_plate.py kingdom-david
  python3 scripts/digitize/trace_era_plate.py israel-jesus
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
HIST = ROOT / "media" / "historical"
GEOREF = ROOT / "scripts" / "georef" / "israel-frame.npz"
OUT_DIR = ROOT / "data" / "overlays"

# Mediterranean coastline (same as divided-kingdom vectorize) — plate coast is schematic.
COAST = [
    (33.80, 31.13), (34.00, 31.19), (34.12, 31.24), (34.24, 31.32), (34.33, 31.42), (34.43, 31.52),
    (34.50, 31.60), (34.55, 31.67), (34.60, 31.76), (34.63, 31.80), (34.68, 31.88), (34.71, 31.95),
    (34.74, 32.02), (34.75, 32.06), (34.77, 32.10), (34.80, 32.17), (34.83, 32.26), (34.85, 32.33),
    (34.87, 32.42), (34.89, 32.50), (34.92, 32.62), (34.94, 32.70), (34.95, 32.78), (34.96, 32.83),
    (35.00, 32.82), (35.03, 32.81), (35.07, 32.85), (35.065, 32.92), (35.085, 32.97), (35.09, 33.01),
    (35.10, 33.09), (35.13, 33.12), (35.19, 33.21), (35.19, 33.27), (35.23, 33.35), (35.29, 33.45),
    (35.34, 33.52), (35.37, 33.56), (35.41, 33.66), (35.44, 33.72), (35.47, 33.83), (35.48, 33.90),
    (35.52, 33.91), (35.58, 33.92), (35.60, 33.95), (35.63, 33.98), (35.64, 34.06), (35.65, 34.12),
    (35.66, 34.20), (35.66, 34.25), (35.72, 34.32), (35.78, 34.38), (35.83, 34.44), (35.90, 34.47),
    (35.96, 34.52), (35.98, 34.60), (35.98, 34.70),
]

PLATES = {
    "kingdom-david": {
        "file": "kingdom-david.jpg",
        "out": "kingdom-david.json",
        "title": "Kingdom of David",
        "era": "United monarchy (2 Samuel 5–24 / 1 Kings 1–11)",
        "classes": ["bg", "water", "israel", "vassal", "phoenicia"],
        "samples": {
            "bg": [(1400, 1200), (600, 1900), (100, 1900), (1450, 850), (200, 200)],
            "water": [(300, 800), (200, 1300), (876, 1250), (940, 610)],
            "israel": [
                (750, 1100), (900, 900), (700, 1500), (500, 1660), (1000, 1000),
                (1050, 700), (800, 1300), (950, 1200), (600, 1400), (1100, 850),
            ],
            "vassal": [
                (1200, 400), (1250, 300), (1150, 500),  # Aram / Maakah / Geshur
                (450, 1280), (420, 1350), (480, 1220),  # Philistia
                (1180, 1080), (1220, 1120),  # Ammon
                (1100, 1450), (1150, 1520), (1080, 1480),  # Moab
                (1000, 1750), (980, 1700), (1050, 1850),  # Edom
            ],
            "phoenicia": [(880, 300), (850, 200), (900, 100), (780, 500)],
        },
        "boxes": {
            # Keep Israel west of the Ammon/Moab plateau so pink vassals stay pink.
            "israel": (250, 1950, 250, 1200),
            "vassal": (0, 2000, 50, 1500),
            "phoenicia": (0, 720, 650, 1060),
        },
        # After classification, split the continuous vassal ring into named neighbours by bbox.
        "split_vassal": {
            "philistia": (1050, 1600, 250, 700),
            "ammon": (950, 1280, 1050, 1400),
            "moab": (1300, 1650, 900, 1350),
            "edom": (1600, 1990, 800, 1300),
            "aram": (0, 900, 900, 1500),
        },
        "props": {
            "israel": {"id": "israel", "name": "Kingdom of Israel", "shortName": "Israel",
                       "eraLabel": "United monarchy", "color": "#9aab5c", "fillOpacity": 0.32},
            "phoenicia": {"id": "phoenicia", "name": "Phoenicia", "shortName": "Phoenicia",
                          "eraLabel": "Ally", "color": "#d08a50", "fillOpacity": 0.28},
            "philistia": {"id": "philistia", "name": "Philistia", "shortName": "Philistia",
                          "eraLabel": "Vassal", "color": "#c4a0a8", "fillOpacity": 0.30},
            "ammon": {"id": "ammon", "name": "Ammon", "shortName": "Ammon",
                      "eraLabel": "Vassal", "color": "#c4a0a8", "fillOpacity": 0.30},
            "moab": {"id": "moab", "name": "Moab", "shortName": "Moab",
                     "eraLabel": "Vassal", "color": "#c4a0a8", "fillOpacity": 0.30},
            "edom": {"id": "edom", "name": "Edom", "shortName": "Edom",
                     "eraLabel": "Vassal", "color": "#c4a0a8", "fillOpacity": 0.30},
            "aram": {"id": "aram", "name": "Aram / Maakah / Geshur", "shortName": "Aram",
                     "eraLabel": "Vassal", "color": "#c4a0a8", "fillOpacity": 0.30},
        },
        "feature_order": ["israel", "philistia", "phoenicia", "ammon", "moab", "edom", "aram"],
        "keep_all_components": {"vassal"},
        "checks": {
            "israel": [(35.2296, 31.7784), (34.8516, 31.252), (35.1903, 32.2764), (35.6525, 33.2486)],
            "philistia": [(34.57, 31.67)],
            "phoenicia": [(35.3758, 33.5606)],
            "ammon": [(35.95, 31.95)],
            "moab": [(35.70, 31.18)],
            "edom": [(35.60, 30.80)],
            "aram": [(36.2765, 33.5138)],
        },
    },
    "israel-jesus": {
        "file": "israel-jesus.jpg",
        "out": "israel-jesus.json",
        "title": "Israel in the Time of Jesus",
        "era": "Gospels / early Acts",
        "classes": ["bg", "water", "prefects", "antipas", "philip", "syria"],
        "samples": {
            "bg": [(1400, 1200), (600, 1900), (100, 1900), (1080, 1600), (1300, 1700)],
            "water": [(300, 800), (200, 1300), (876, 1250), (940, 610)],
            "prefects": [
                (700, 1400), (750, 1200), (600, 1100), (500, 1550), (780, 1000),
                (700, 900), (650, 1300), (800, 1150), (550, 1450),
            ],
            "antipas": [
                (850, 700), (900, 650), (800, 750), (950, 720), (880, 680),
                (1050, 1150), (1080, 1100), (1020, 1250), (1060, 1300), (1040, 1050),
            ],
            "philip": [
                (1100, 500), (1150, 450), (1050, 550), (1200, 400), (1120, 480), (1180, 520),
            ],
            "syria": [
                (880, 300), (900, 200), (850, 250), (1150, 800), (1200, 900),
                (1180, 750), (400, 1600), (450, 1550),
            ],
        },
        "boxes": {
            "prefects": (700, 1850, 200, 1000),
            "antipas": (400, 1450, 650, 1250),
            "philip": (200, 800, 900, 1450),
            "syria": (0, 2000, 50, 1500),
        },
        "split_vassal": None,
        "props": {
            "prefects": {"id": "prefects", "name": "Judea / Samaria / Idumea (Prefects)",
                         "shortName": "Judea", "eraLabel": "Prefects",
                         "color": "#9aab5c", "fillOpacity": 0.30},
            "antipas": {"id": "antipas", "name": "Galilee & Perea (Herod Antipas)",
                        "shortName": "Antipas", "eraLabel": "Herod Antipas",
                        "color": "#b08a9a", "fillOpacity": 0.32},
            "philip": {"id": "philip", "name": "Iturea & Trachonitis (Philip)",
                       "shortName": "Philip", "eraLabel": "Philip",
                       "color": "#d4a060", "fillOpacity": 0.30},
            "syria": {"id": "syria", "name": "Syrian Territory",
                      "shortName": "Syria", "eraLabel": "Syria",
                      "color": "#c07060", "fillOpacity": 0.28},
        },
        "feature_order": ["prefects", "antipas", "philip", "syria"],
        "checks": {
            "prefects": [(35.2296, 31.7784), (35.1903, 32.2764)],  # Jerusalem, Samaria
            "antipas": [(35.2978, 32.6996), (35.55, 31.90)],  # Nazareth, Perea (Bethabara area)
            "philip": [(35.694, 33.248)],  # Caesarea Philippi
            "syria": [(35.3758, 33.5606), (35.20, 33.27)],  # Sidon, Tyre
        },
        "keep_all_components": {"antipas"},  # Galilee + Perea
    },
}


def load_georef():
    z = np.load(GEOREF)
    cl, ca = z["coef_lon"], z["coef_lat"]
    Aff = np.array([[cl[0], cl[1]], [ca[0], ca[1]]])
    off = np.array([cl[2], ca[2]])
    return cl, ca, np.linalg.inv(Aff), off


def px2ll(cl, ca, x, y):
    return (cl[0] * x + cl[1] * y + cl[2], ca[0] * x + ca[1] * y + ca[2])


def ll2px(Ainv, off, lon, lat):
    return Ainv @ (np.array([lon, lat]) - off)


def classify(img, cfg):
    H, W = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    classes = cfg["classes"]
    cid = {c: i for i, c in enumerate(classes)}
    cents = []
    for c, pts in cfg["samples"].items():
        for x, y in pts:
            patch = lab[y - 6:y + 7, x - 6:x + 7].reshape(-1, 3)
            med = np.median(patch, 0)
            cents.append((cid[c], *med))
    cents = np.array(cents, dtype=np.float32)
    WL = 0.45
    feat = np.stack([WL * L, A, B], -1).reshape(-1, 3)
    cfeat = np.stack([WL * cents[:, 1], cents[:, 2], cents[:, 3]], -1)
    d2 = ((feat[:, None, :] - cfeat[None, :, :]) ** 2).sum(-1)
    yy, xx = np.mgrid[0:H, 0:W]
    yy = yy.reshape(-1)
    xx = xx.reshape(-1)
    for k in range(len(cents)):
        c = classes[int(cents[k, 0])]
        box = cfg["boxes"].get(c)
        if not box:
            continue
        y0, y1, x0, x1 = box
        bad = ~((yy >= y0) & (yy < y1) & (xx >= x0) & (xx < x1))
        d2[bad, k] = np.inf
    best = d2.argmin(1)
    bestd = np.sqrt(d2[np.arange(len(best)), best]).reshape(H, W)
    labels = cents[best, 0].astype(np.int16).reshape(H, W)
    chroma = np.hypot(A - 128, B - 128)
    unknown = (bestd > 18) | (L < 70) | ((L > 235) & (chroma < 10))
    labels[unknown] = -1
    idx = ndi.distance_transform_edt(unknown, return_distances=False, return_indices=True)
    filled = labels[idx[0], idx[1]]
    K = len(classes)
    onehot = np.zeros((K, H, W), np.float32)
    for k in range(K):
        m = (filled == k).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        onehot[k] = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 5)
    reg = onehot.argmax(0).astype(np.int16)
    keep_multi = cfg.get("keep_all_components", set())
    for k, c in enumerate(classes):
        if k < 2:
            continue
        m = (reg == k).astype(np.uint8)
        n, cc, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
        if n <= 2:
            continue
        if c in keep_multi:
            # Keep every substantial component (vassal ring pieces; Galilee+Perea).
            min_area = 3000 if c == "vassal" else 5000
            for i in range(1, n):
                if stats[i, cv2.CC_STAT_AREA] < min_area:
                    reg[cc == i] = 0
            continue
        keep = 1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())
        reg[(cc != keep) & (cc != 0)] = 0
    # fill small holes inside kingdom classes
    for k in range(2, K):
        m = (reg == k).astype(np.uint8)
        n, cc, stats, _ = cv2.connectedComponentsWithStats((1 - m).astype(np.uint8), connectivity=4)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 10000:
                reg[cc == i] = k
    return reg, classes


def snap_coast(canvas, cid_water, EXT, Ainv, off):
    sea_poly = [(32.0, 30.5)] + COAST + [(32.0, 35.0)]
    sea_pts = np.array([ll2px(Ainv, off, lo, la) for lo, la in sea_poly])
    sea_pts[:, 1] += EXT
    sea_px = cv2.fillPoly(np.zeros(canvas.shape, np.uint8), [np.round(sea_pts).astype(np.int32)], 1).astype(bool)
    water = (canvas == cid_water).astype(np.uint8)
    n, cc = cv2.connectedComponents(water, connectivity=4)
    areas = np.bincount(cc.ravel())
    areas[0] = 0
    med = cc == areas.argmax()
    kingdom = canvas >= 2
    dist_k = cv2.distanceTransform((~kingdom).astype(np.uint8), cv2.DIST_L2, 5)
    ext_region = np.zeros(canvas.shape, bool)
    ext_region[: EXT + 5] = True
    to_fill = (~sea_px) & (med | (ext_region & (canvas == 0) & (dist_k < 90)))
    canvas[sea_px] = cid_water
    cand = ~(to_fill | (canvas == cid_water))
    idx = ndi.distance_transform_edt(~cand, return_distances=False, return_indices=True)
    filled = canvas[idx[0], idx[1]]
    canvas[to_fill] = filled[to_fill]
    return canvas


def split_vassal(canvas, classes, split_map, y_offset=0):
    """Split continuous vassal ring into named neighbours. Boxes are in plate coords;
    pass y_offset=EXT when canvas has been padded at the top."""
    if not split_map:
        return canvas, classes
    cid = {c: i for i, c in enumerate(classes)}
    vassal_id = cid["vassal"]
    next_id = len(classes)
    new_classes = list(classes)
    for name, (y0, y1, x0, x1) in split_map.items():
        mask = canvas == vassal_id
        box = np.zeros_like(mask)
        box[y0 + y_offset:y1 + y_offset, x0:x1] = True
        region = mask & box
        n, cc, stats, _ = cv2.connectedComponentsWithStats(region.astype(np.uint8), connectivity=4)
        if n <= 1:
            print(f"  split {name}: empty")
            continue
        keep = 1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())
        area = int(stats[keep, cv2.CC_STAT_AREA])
        canvas[cc == keep] = next_id
        new_classes.append(name)
        print(f"  split {name}: {area} px")
        next_id += 1
    if (canvas == vassal_id).any():
        leftover = int((canvas == vassal_id).sum())
        if "aram" in new_classes:
            canvas[canvas == vassal_id] = new_classes.index("aram")
            print(f"  leftover vassal {leftover} px → aram")
        else:
            idx = ndi.distance_transform_edt(canvas == vassal_id, return_distances=False, return_indices=True)
            canvas = canvas[idx[0], idx[1]]
            print(f"  leftover vassal {leftover} px → nearest")
    return canvas, new_classes


def dp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    dmax, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        if L2 == 0:
            d = math.hypot(px - ax, py - ay)
        else:
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return dp(pts[: idx + 1], eps)[:-1] + dp(pts[idx:], eps)
    return [a, b]


def chaikin_open(pts, it):
    for _ in range(it):
        if len(pts) < 3:
            return pts
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


def extract_arcs(P):
    Hp, Wp = P.shape
    hE = np.zeros((Hp + 1, Wp), bool)
    vE = np.zeros((Hp, Wp + 1), bool)
    hE[1:Hp, :] = P[:-1, :] != P[1:, :]
    vE[:, 1:Wp] = P[:, :-1] != P[:, 1:]
    deg = np.zeros((Hp + 1, Wp + 1), np.int8)
    deg[:, :-1] += hE
    deg[:, 1:] += hE
    deg[:-1, :] += vE
    deg[1:, :] += vE
    junction = deg >= 3
    visited_h = np.zeros_like(hE)
    visited_v = np.zeros_like(vE)

    def incident(r, c):
        out = []
        if c < Wp and hE[r, c]:
            out.append(("h", r, c, (r, c + 1)))
        if c > 0 and hE[r, c - 1]:
            out.append(("h", r, c - 1, (r, c - 1)))
        if r < Hp and vE[r, c]:
            out.append(("v", r, c, (r + 1, c)))
        if r > 0 and vE[r - 1, c]:
            out.append(("v", r - 1, c, (r - 1, c)))
        return out

    def side_labels(kind, er, ec, frm, to):
        if kind == "h":
            above = P[er - 1, ec] if er - 1 >= 0 else 0
            below = P[er, ec] if er < Hp else 0
            return (above, below) if to[1] > frm[1] else (below, above)
        left_px = P[er, ec - 1] if ec - 1 >= 0 else 0
        right_px = P[er, ec] if ec < Wp else 0
        return (right_px, left_px) if to[0] > frm[0] else (left_px, right_px)

    def mark(kind, er, ec):
        if kind == "h":
            visited_h[er, ec] = True
        else:
            visited_v[er, ec] = True

    def is_visited(kind, er, ec):
        return visited_h[er, ec] if kind == "h" else visited_v[er, ec]

    arcs = []

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
    for kind, E, V in (("h", hE, visited_h), ("v", vE, visited_v)):
        rem = np.argwhere(E & ~V)
        for er, ec in rem:
            if V[er, ec]:
                continue
            start = (er, ec)
            edge = (kind, er, ec, (er, ec + 1) if kind == "h" else (er + 1, ec))
            arcs.append(walk(start, edge))
    return arcs


def ring_area(pts):
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s / 2


def inside(lon, lat, ring):
    x, y = lon, lat
    n = len(ring)
    odd = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi):
            odd = not odd
        j = i
    return odd


def assemble(arcs, canvas, classes, cfg, cl, ca, EXT):
    features = []
    cid = {c: i for i, c in enumerate(classes)}
    for kid in cfg["feature_order"]:
        if kid not in cid:
            print(f"skip missing class {kid}")
            continue
        k = cid[kid]
        mine = []
        for a in arcs:
            if a["left"] == k:
                mine.append((a["pts"][0], a["pts"][-1], a["xy"], a["closed"]))
            elif a["right"] == k:
                mine.append((a["pts"][-1], a["pts"][0], a["xy"][::-1], a["closed"]))
        rings = []
        used = [False] * len(mine)
        by_start = {}
        for i, (s, e, xy, closed) in enumerate(mine):
            by_start.setdefault(s, []).append(i)
        for i in range(len(mine)):
            if used[i]:
                continue
            s0, e, xy, closed = mine[i]
            used[i] = True
            if closed:
                rings.append(list(xy))
                continue
            ring = list(xy)
            cur = e
            guard = 0
            while cur != s0 and guard < 10000:
                guard += 1
                nxt = None
                for j in by_start.get(cur, []):
                    if not used[j]:
                        nxt = j
                        break
                if nxt is None:
                    break
                used[nxt] = True
                ring.extend(mine[nxt][2][1:])
                cur = mine[nxt][1]
            rings.append(ring)
        rings.sort(key=lambda r: -abs(ring_area(r)))
        keep_multi = kid in cfg.get("keep_all_components", set())
        keep_rings = rings if keep_multi else rings[:1]
        ll_rings = []
        for r in keep_rings:
            if abs(ring_area(r)) < 50:  # tiny pixel rings
                continue
            ll = [px2ll(cl, ca, x, y) for x, y in r]
            if ring_area(ll) < 0:
                ll = ll[::-1]
            if ll[0] != ll[-1]:
                ll.append(ll[0])
            ll_rings.append([[round(lo, 5), round(la, 5)] for lo, la in ll])
        if not ll_rings:
            print(f"WARNING: no ring for {kid}")
            continue
        props = dict(cfg["props"][kid])
        # label at distance-transform centre of largest component
        m = (canvas == k).astype(np.uint8)
        dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
        y, x = np.unravel_index(dt.argmax(), dt.shape)
        lo, la = px2ll(cl, ca, x, y - EXT)
        props["labelLng"], props["labelLat"] = round(float(lo), 4), round(float(la), 4)
        geom = {"type": "Polygon", "coordinates": [ll_rings[0]]} if len(ll_rings) == 1 else {
            "type": "MultiPolygon", "coordinates": [[r] for r in ll_rings]
        }
        features.append({"type": "Feature", "properties": props, "geometry": geom})
        print(f"{kid:12s} rings={len(ll_rings)} verts={sum(len(r) for r in ll_rings)}")
    return features


def smooth_arcs(arcs, EXT):
    for a in arcs:
        xy = [(c - 1.5, r - 1.5 - EXT) for r, c in a["pts"]]
        if a["closed"]:
            core = dp(xy[:-1] + [xy[0]], 2.0)[:-1]
            sm = chaikin_closed(core, 3)
            sm = dp(sm + [sm[0]], 0.3)[:-1]
        else:
            core = dp(xy, 2.0)
            sm = chaikin_open(core, 3)
            sm = dp(sm, 0.3)
        a["xy"] = sm
    return arcs


def validate(features, checks):
    by = {}
    for f in features:
        g = f["geometry"]
        if g["type"] == "Polygon":
            by[f["properties"]["id"]] = [g["coordinates"][0]]
        else:
            by[f["properties"]["id"]] = [r[0] for r in g["coordinates"]]
    ok = True
    for kid, pts in checks.items():
        rings = by.get(kid, [])
        for lon, lat in pts:
            hit = any(inside(lon, lat, r) for r in rings)
            if not hit:
                ok = False
                print(f"MISS {kid} ({lon},{lat})")
            else:
                print(f"ok   {kid} ({lon},{lat})")
    return ok


def run(plate_key: str):
    cfg = PLATES[plate_key]
    img = cv2.imread(str(HIST / cfg["file"]))
    if img is None:
        raise SystemExit(f"missing plate {cfg['file']}")
    cl, ca, Ainv, off = load_georef()
    reg, classes = classify(img, cfg)
    print("classes", classes, "pixels", {c: int((reg == i).sum()) for i, c in enumerate(classes)})

    EXT = 20  # small pad; no northern political extension for these plates
    H, W = reg.shape
    canvas = np.zeros((H + EXT, W), np.int16)
    canvas[EXT:] = reg
    canvas = snap_coast(canvas, classes.index("water"), EXT, Ainv, off)
    canvas[canvas == classes.index("water")] = 0
    # fill tiny none islands
    none = (canvas == 0).astype(np.uint8)
    n, cc, stats, _ = cv2.connectedComponentsWithStats(none, connectivity=4)
    small = np.zeros_like(none, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 12000:
            small |= cc == i
    if small.any():
        idx = ndi.distance_transform_edt(small, return_distances=False, return_indices=True)
        canvas = canvas[idx[0], idx[1]]

    # regularise
    K = len(classes)
    onehot = np.zeros((K, canvas.shape[0], canvas.shape[1]), np.float32)
    for k in range(K):
        m = (canvas == k).astype(np.float32)
        if m.any():
            onehot[k] = cv2.GaussianBlur(m, (0, 0), 5)
    canvas = onehot.argmax(0).astype(np.int16)

    canvas, classes = split_vassal(canvas, classes, cfg.get("split_vassal"), y_offset=EXT)
    print("final classes", classes)

    # Soft northern anchors for Dan / Abel when the plate colour fringe clips them
    if plate_key == "kingdom-david":
        for lo, la, rx, ry, kid in [
            (35.6525, 33.2486, 14, 14, "israel"),  # Dan
            (35.58, 33.26, 12, 12, "israel"),  # Abel
        ]:
            if kid not in classes:
                continue
            x, y = ll2px(Ainv, off, lo, la)
            cv2.ellipse(
                canvas,
                (int(round(x)), int(round(y + EXT))),
                (rx, ry),
                0,
                0,
                360,
                int(classes.index(kid)),
                -1,
            )

    P = np.pad(canvas, 1, constant_values=0)
    arcs = extract_arcs(P)
    arcs = smooth_arcs(arcs, EXT)
    features = assemble(arcs, canvas, classes, cfg, cl, ca, EXT)
    validate(features, cfg["checks"])

    out = {
        "type": "FeatureCollection",
        "meta": {
            "title": cfg["title"],
            "era": cfg["era"],
            "source": f"Digitized from media/historical/{cfg['file']}",
            "disclaimer": "Illustrative teaching overlays traced from the bundled atlas plate; borders are approximate.",
            "georef": "Shared Israel-frame affine (scripts/georef/israel-frame.npz).",
            "smoothing": "Shared-boundary arcs + Douglas-Peucker + Chaikin; seaward edge snapped to real Mediterranean coastline.",
        },
        "features": features,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / cfg["out"]
    path.write_text(json.dumps(out, indent=2) + "\n")
    print("wrote", path)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in PLATES:
        print("Usage: trace_era_plate.py [kingdom-david|israel-jesus]")
        raise SystemExit(2)
    run(sys.argv[1])
