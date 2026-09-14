#!/usr/bin/env python3
"""Build an auditable avalanche-activity training table.

Input rows must already represent either observed avalanche presences or explicitly
labelled background/pseudo-absence samples. The script never assumes missing events
are negatives.
"""
from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def require_columns(df: pd.DataFrame, names: list[str], source: str) -> None:
    missing = [n for n in names if n not in df.columns]
    if missing:
        raise SystemExit(f"{source} is missing required columns: {', '.join(missing)}")


def aspect_components(deg: pd.Series) -> tuple[pd.Series, pd.Series]:
    rad = np.deg2rad(pd.to_numeric(deg, errors="coerce"))
    return pd.Series(np.sin(rad), index=deg.index), pd.Series(np.cos(rad), index=deg.index)


def spatial_block(lat: float, lon: float, km: float = 10.0) -> str:
    # Approximate equal-size blocks adequate for CV grouping, not GIS analysis.
    y = int(math.floor(lat * 111.32 / km))
    x = int(math.floor(lon * 111.32 * max(math.cos(math.radians(lat)), 0.2) / km))
    return f"{x}:{y}"


def fetch_weather(lat: float, lon: float, timestamp: pd.Timestamp, session: requests.Session) -> dict:
    end = timestamp.floor("D")
    start = end - pd.Timedelta(days=4)
    params = {
        "latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}",
        "start_date": start.strftime("%Y-%m-%d"), "end_date": end.strftime("%Y-%m-%d"),
        "hourly": "temperature_2m,precipitation,rain,snowfall,snow_depth,wind_speed_10m,wind_gusts_10m,wind_direction_10m,shortwave_radiation",
        "timezone": "UTC"
    }
    r = session.get(ARCHIVE_URL, params=params, timeout=35)
    r.raise_for_status()
    h = r.json().get("hourly", {})
    if not h.get("time"):
        return {}
    w = pd.DataFrame(h)
    w["time"] = pd.to_datetime(w["time"], utc=True)
    ts = timestamp.tz_convert("UTC") if timestamp.tzinfo else timestamp.tz_localize("UTC")
    w = w[w.time < ts]
    if w.empty:
        return {}
    last24, last72 = w[w.time > ts-pd.Timedelta(hours=24)], w[w.time > ts-pd.Timedelta(hours=72)]
    def summ(frame: pd.DataFrame, col: str) -> float:
        return float(pd.to_numeric(frame[col], errors="coerce").sum(min_count=len(frame))) if col in frame and len(frame) else np.nan
    def maxi(frame: pd.DataFrame, col: str) -> float:
        return float(pd.to_numeric(frame.get(col), errors="coerce").max()) if col in frame else np.nan
    def mean(frame: pd.DataFrame, col: str) -> float:
        return float(pd.to_numeric(frame.get(col), errors="coerce").mean()) if col in frame else np.nan
    def circular_mean(frame, col):
        if col not in frame: return np.nan
        angles = np.deg2rad(pd.to_numeric(frame[col], errors='coerce').dropna())
        if len(angles) == 0: return np.nan
        x, y = np.cos(angles).mean(), np.sin(angles).mean()
        return float(np.rad2deg(np.arctan2(y, x)) % 360) if np.hypot(x, y) > 1e-6 else np.nan
    snowfall24 = summ(last24, "snowfall")
    snowfall72 = summ(last72, "snowfall")
    # Open-Meteo snowfall is documented as cm.
    return {
        "snowfall_24h_cm": snowfall24,
        "snowfall_72h_cm": snowfall72,
        "rain_24h_mm": summ(last24, "rain"),
        "precip_24h_mm": summ(last24, "precipitation"),
        "temp_mean_24h_c": mean(last24, "temperature_2m"),
        "temp_max_24h_c": maxi(last24, "temperature_2m"),
        "wind_mean_24h_kmh": mean(last24, "wind_speed_10m"),
        "wind_gust_max_24h_kmh": maxi(last24, "wind_gusts_10m"),
        "wind_dir_mean_24h_deg": circular_mean(last24, "wind_direction_10m"),
        "solar_24h_whm2_proxy": summ(last24, "shortwave_radiation"),
        "snow_depth_m": float(pd.to_numeric(w.get("snow_depth"), errors="coerce").dropna().iloc[-1]) if "snow_depth" in w and pd.to_numeric(w.get("snow_depth"), errors="coerce").notna().any() else np.nan,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True, type=Path, help="CSV of presence rows; label forced to 1.")
    ap.add_argument("--background", type=Path, help="CSV of background/pseudo-absence rows; label forced to 0.")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--fetch-weather", action="store_true", help="Query Open-Meteo historical weather per row (slow; cache output afterwards).")
    ap.add_argument("--block-km", type=float, default=10.0)
    args = ap.parse_args()

    events = pd.read_csv(args.events)
    require_columns(events, ["lat", "lon", "observed_at"], str(args.events))
    events["label"] = 1
    if "label_kind" not in events:
        events["label_kind"] = "presence"
    frames = [events]
    if args.background:
        bg = pd.read_csv(args.background)
        require_columns(bg, ["lat", "lon", "observed_at"], str(args.background))
        bg["label"] = 0
        if "label_kind" not in bg:
            bg["label_kind"] = "background"
        frames.append(bg)
    df = pd.concat(frames, ignore_index=True)
    df["observed_at"] = pd.to_datetime(df["observed_at"], utc=True, errors="coerce")
    df = df[df.observed_at.notna()].copy()
    df["spatial_block"] = [spatial_block(float(a), float(o), args.block_km) for a,o in zip(df.lat, df.lon)]
    df["season_year"] = np.where(df.observed_at.dt.month >= 9, df.observed_at.dt.year, df.observed_at.dt.year - 1)
    if "aspect_deg" in df:
        df["aspect_sin"], df["aspect_cos"] = aspect_components(df["aspect_deg"])

    if args.fetch_weather:
        session = requests.Session()
        rows = []
        for i, row in df.iterrows():
            try:
                rows.append(fetch_weather(float(row.lat), float(row.lon), row.observed_at, session))
            except Exception as exc:
                print(f"weather warning row {i}: {exc}")
                rows.append({})
            time.sleep(0.08)
        weather = pd.DataFrame(rows, index=df.index)
        for col in weather:
            df[col] = weather[col]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote {len(df)} rows to {args.out}; positives={int(df.label.sum())}, background={int((df.label==0).sum())}")


if __name__ == "__main__":
    main()
