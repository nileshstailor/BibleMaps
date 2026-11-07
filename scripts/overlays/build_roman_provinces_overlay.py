#!/usr/bin/env python3
"""Build Mediterranean Roman province polygons for Bible Maps Paul-era presets.

Source: barionleg/roman-empire data/provinces.geojson (AWMC-derived, ODbL).
Provincial geometry is ~AD 200; suitable for Acts teaching (see overlay meta disclaimer).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import shapely.geometry as geom
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts" / "overlays" / "source" / "provinces.geojson"
OUT = ROOT / "data" / "overlays" / "roman-provinces-mediterranean.json"

# Bible Maps Paul / Mediterranean presets corridor (W, S, E, N)
CLIP = geom.box(5.0, 28.0, 40.0, 46.0)

ROMAN_NUMERAL = re.compile(r"^[IVXLC]+$")

# Teaching palette (distinct fills; empire border uses separate overlay).
COLORS = {
    "italia": "#c85a3a",
    "sicilia": "#9a6b9e",
    "africa": "#c85a3a",
    "mauretania_caesariensis": "#b87448",
    "numidia": "#a86850",
    "aegyptus": "#e09850",
    "creta_cyrene": "#5a7a9a",
    "cyprus": "#6a9a5c",
    "iudaea": "#b8b84a",
    "arabia": "#c8a858",
    "syria": "#4a7a6a",
    "cilicia": "#d8a070",
    "lycia_pamphylia": "#5a8a62",
    "asia": "#e0a060",
    "galatia_cappadocia": "#78a878",
    "bithynia_pontus": "#c86878",
    "armenia_mesopotamia": "#88a8c8",
    "macedonia": "#8a7a72",
    "achaia": "#d8a0b0",
    "thracia": "#62a068",
    "moesia_inferior": "#7a9a88",
    "moesia_superior": "#6a8a78",
    "dalmatia": "#9a8a9a",
    "sardinia_corsica": "#b090a8",
    "narbonensis": "#c07858",
    "dacia": "#8a9888",
    "pannonia_inferior": "#a0a890",
    "pannonia_superior": "#98a088",
    "alpes": "#a8b0a0",
}

ITALY_REGIONS = {f"{n}" for n in [
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI",
]}
ITALY_ALPES = {
    "Alpes Cottiae",
    "Alpes Graiae et Poeninae",
    "Alpes Maritimae",
}

NAME_MAP = {
    "Iudaea": ("iudaea", "Judaea", "JUDAEA"),
    "Syria": ("syria", "Syria", "SYRIA"),
    "Cilicia": ("cilicia", "Cilicia", "CILICIA"),
    "Cyprus": ("cyprus", "Cyprus", "CYPRUS"),
    "Asia": ("asia", "Asia", "ASIA"),
    "Macedonia": ("macedonia", "Macedonia", "MACEDONIA"),
    "Achaia": ("achaia", "Achaia", "ACHAIA"),
    "Thracia": ("thracia", "Thracia", "THRACE"),
    "Sicilia": ("sicilia", "Sicily", "SICILY"),
    "Aegyptus": ("aegyptus", "Egypt", "EGYPT"),
    "Africa Proconsularis": ("africa", "Africa", "AFRICA"),
    "Mauretania Caesariensis": ("mauretania_caesariensis", "Mauretania", "MAURETANIA"),
    "Numidia": ("numidia", "Numidia", "NUMIDIA"),
    "Arabia": ("arabia", "Arabia", "ARABIA"),
    "Armenia Mesopotamia": ("armenia_mesopotamia", "Armenia / Mesopotamia", "ARMENIA"),
    "Galatia et Cappadocia": ("galatia_cappadocia", "Galatia & Cappadocia", "GALATIA"),
    "Bithynia et Pontus": ("bithynia_pontus", "Bithynia & Pontus", "BITHYNIA"),
    "Lycia et Pamphylia": ("lycia_pamphylia", "Lycia & Pamphylia", "LYCIA"),
    "Creta et Cyrene": ("creta_cyrene", "Crete & Cyrene", "CRETE"),
    "Sardinia et Corsica": ("sardinia_corsica", "Sardinia & Corsica", "SARDINIA"),
    "Narbonensis": ("narbonensis", "Narbonensis", "GAUL"),
    "Dalmatia": ("dalmatia", "Dalmatia", "DALMATIA"),
    "Moesia Inferior": ("moesia_inferior", "Moesia Inf.", "MOESIA"),
    "Moesia Superior": ("moesia_superior", "Moesia Sup.", "MOESIA"),
    "Dacia": ("dacia", "Dacia", "DACIA"),
    "Pannonia Inferior": ("pannonia_inferior", "Pannonia Inf.", "PANNONIA"),
    "Pannonia Superior": ("pannonia_superior", "Pannonia Sup.", "PANNONIA"),
}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def round_coords(g, precision: int = 4):
    def _round_coords(seq):
        if isinstance(seq[0], (float, int)):
            return [round(float(seq[0]), precision), round(float(seq[1]), precision)]
        return [_round_coords(s) for s in seq]

    g = json.loads(json.dumps(g))
    g["coordinates"] = _round_coords(g["coordinates"])
    return g


def to_feature(geom_part, props: dict) -> dict | None:
    if geom_part.is_empty:
        return None
    simplified = geom_part.simplify(0.02, preserve_topology=True)
    if simplified.is_empty:
        return None
    if simplified.geom_type == "GeometryCollection":
        polys = [g for g in simplified.geoms if not g.is_empty]
        if not polys:
            return None
        simplified = unary_union(polys)
    g = mapping(simplified)
    g = round_coords(g)
    rep = simplified.representative_point()
    props = dict(props)
    props["labelLng"] = round(rep.x, 4)
    props["labelLat"] = round(rep.y, 4)
    return {"type": "Feature", "properties": props, "geometry": g}


def build_groups(data: dict) -> dict[str, list]:
    groups: dict[str, list] = {}
    italy: list = []

    for feat in data["features"]:
        raw = feat["properties"].get("name") or ""
        try:
            shp = shape(feat["geometry"])
        except Exception:
            continue
        shp = shp.intersection(CLIP)
        if shp.is_empty:
            continue
        if raw in ITALY_REGIONS:
            italy.append(shp)
            continue
        if raw in ITALY_ALPES:
            italy.append(shp)
            continue
        if raw in NAME_MAP:
            gid, *_ = NAME_MAP[raw]
            groups.setdefault(gid, []).append(shp)
            continue
        if ROMAN_NUMERAL.match(raw):
            italy.append(shp)
            continue

    if italy:
        groups.setdefault("italia", []).extend(italy)
    return groups


def main() -> int:
    if not SRC.is_file():
        print(f"Missing source {SRC}. Download:", file=sys.stderr)
        print(
            "  curl -L -o scripts/overlays/source/provinces.geojson "
            "https://raw.githubusercontent.com/barionleg/roman-empire/master/data/provinces.geojson",
            file=sys.stderr,
        )
        return 2

    data = json.loads(SRC.read_text())
    groups = build_groups(data)

    features = []
    order = [
        "italia", "sicilia", "sardinia_corsica", "africa", "numidia", "mauretania_caesariensis",
        "aegyptus", "creta_cyrene", "cyprus", "iudaea", "arabia", "syria", "cilicia",
        "lycia_pamphylia", "asia", "galatia_cappadocia", "bithynia_pontus", "armenia_mesopotamia",
        "macedonia", "achaia", "thracia", "moesia_inferior", "moesia_superior", "dalmatia",
        "narbonensis", "dacia", "pannonia_inferior", "pannonia_superior",
    ]
    titles = {
        "italia": ("Roman Italy", "ITALY"),
        "sicilia": ("Sicilia", "SICILY"),
        "africa": ("Africa Proconsularis", "AFRICA"),
        "creta_cyrene": ("Crete & Cyrene", "CRETE"),
    }
    for gid in order:
        parts = groups.get(gid)
        if not parts:
            continue
        merged = unary_union(parts)
        color = COLORS.get(gid, "#a0a0a0")
        name_entry = next((v for v in NAME_MAP.values() if v[0] == gid), None)
        if name_entry:
            _, long_name, short = name_entry
        elif gid in titles:
            long_name, short = titles[gid]
        else:
            long_name, short = gid.replace("_", " ").title(), gid.split("_")[0].upper()
        props = {
            "id": gid,
            "name": long_name,
            "shortName": short,
            "eraLabel": "Roman province",
            "color": color,
            "fillOpacity": 0.34,
        }
        feat = to_feature(merged, props)
        if feat:
            features.append(feat)
            print(f"  {gid}: {merged.geom_type}")

    out = {
        "type": "FeatureCollection",
        "meta": {
            "title": "Roman provinces (Mediterranean corridor)",
            "era": "Acts / Paul journeys",
            "source": "Derived from barionleg/roman-empire provinces.geojson (AWMC geodata, ODbL 1.0).",
            "disclaimer": (
                "Illustrative provincial subdivisions (~AD 200, AWMC). Borders approximate "
                "for Acts-era teaching; clipped to the Paul map corridor (5–40°E, 28–46°N)."
            ),
            "license": "ODbL 1.0 — credit AWMC / adapted for Bible Maps.",
        },
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT} ({len(features)} provinces, {OUT.stat().st_size // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
