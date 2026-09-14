#!/usr/bin/env python3
"""Normalize a licence-cleared historical avalanche GeoJSON for the app.

This script deliberately does not scrape or download provider datasets. Use it only
on source files whose reuse/redistribution terms you have confirmed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--source", required=True)
    ap.add_argument("--inventory-kind", required=True, choices=["event", "observation", "historical_extent", "release_area", "path", "runout"])
    ap.add_argument("--source-url", default="")
    ap.add_argument("--source-license", default="")
    ap.add_argument("--id-field", default="")
    ap.add_argument("--date-field", default="")
    args = ap.parse_args()

    data = json.loads(args.input.read_text())
    if data.get("type") != "FeatureCollection":
        raise SystemExit("Input must be a GeoJSON FeatureCollection in EPSG:4326.")
    out = []
    for i, feature in enumerate(data.get("features", []), 1):
        if not feature.get("geometry"):
            continue
        p = dict(feature.get("properties") or {})
        source_id = p.get(args.id_field) if args.id_field else p.get("source_event_id") or feature.get("id") or f"{args.source}-{i}"
        event_date = p.get(args.date_field) if args.date_field else p.get("event_date") or p.get("date")
        normalized = {
            "source": args.source,
            "source_event_id": str(source_id),
            "inventory_kind": args.inventory_kind,
            "event_date": event_date,
            "source_url": args.source_url,
            "source_license": args.source_license,
            "original_properties": p
        }
        out.append({"type": "Feature", "id": str(source_id), "geometry": feature["geometry"], "properties": normalized})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"type": "FeatureCollection", "features": out}, ensure_ascii=False))
    print(f"Wrote {len(out)} normalized features to {args.output}")


if __name__ == "__main__":
    main()
