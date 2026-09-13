#!/usr/bin/env python3
"""Build deterministic terrain features from a projected high-resolution DEM.

This is a preprocessing utility for research/development. Its release/runout
scores are geometric screening features, not an operational avalanche model.
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from scipy.ndimage import maximum_filter, minimum_filter, uniform_filter

NODATA = -9999.0


def _normalize01(a: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return np.clip((a - lo) / max(hi - lo, 1e-9), 0.0, 1.0)


def _local_std(a: np.ndarray, size: int = 5) -> np.ndarray:
    mean = uniform_filter(a, size=size, mode="nearest")
    mean2 = uniform_filter(a * a, size=size, mode="nearest")
    return np.sqrt(np.maximum(mean2 - mean * mean, 0.0))


def terrain_features(z: np.ndarray, dx: float, dy: float) -> list[np.ndarray]:
    # np.gradient returns d/dy then d/dx.
    dz_dy, dz_dx = np.gradient(z, dy, dx)
    grad = np.hypot(dz_dx, dz_dy)
    slope = np.degrees(np.arctan(grad))
    aspect = (np.degrees(np.arctan2(-dz_dx, dz_dy)) + 360.0) % 360.0

    d2z_dy2, d2z_dydx = np.gradient(dz_dy, dy, dx)
    d2z_dxdy, d2z_dx2 = np.gradient(dz_dx, dy, dx)
    dxy = 0.5 * (d2z_dydx + d2z_dxdy)

    # Stable curvature proxies in projected units. We keep raw values because
    # downstream calibration should decide their relevant scale.
    eps = 1e-6
    p, q = dz_dx, dz_dy
    r, s, t = d2z_dx2, dxy, d2z_dy2
    denom_profile = (p * p + q * q) * np.power(1.0 + p * p + q * q, 1.5) + eps
    profile = -(r * p * p + 2 * s * p * q + t * q * q) / denom_profile
    denom_plan = np.power(p * p + q * q, 1.5) + eps
    plan = (r * q * q - 2 * s * p * q + t * p * p) / denom_plan

    rugged = _local_std(z, size=5)

    # Potential release area: strongest around classic slab terrain, reduced
    # on very low and extremely steep slopes. Convexity slightly increases it.
    rise = _normalize01(slope, 25.0, 32.0)
    fall = 1.0 - _normalize01(slope, 47.0, 60.0)
    slope_release = np.clip(rise * fall, 0.0, 1.0)
    convex = _normalize01(-profile, 0.0, 0.08)
    release = np.clip(0.88 * slope_release + 0.12 * convex, 0.0, 1.0)

    # Connected/overhead proxy: nearby higher relief and nearby release terrain.
    # ~250 m radius where possible; odd filter size capped to avoid huge kernels.
    cell = max((abs(dx) + abs(dy)) / 2.0, 1.0)
    radius_cells = max(2, min(51, int(round(250.0 / cell))))
    size = radius_cells * 2 + 1
    high_near = maximum_filter(z, size=size, mode="nearest")
    release_near = maximum_filter(release, size=size, mode="nearest")
    relief = np.maximum(high_near - z, 0.0)
    overhead = np.clip(release_near * _normalize01(relief, 30.0, 250.0), 0.0, 1.0)

    # Runout corridor proxy: low/medium-slope cells beneath substantial nearby
    # relief get a screening score. This intentionally does NOT claim to model
    # avalanche dynamics or stopping distance.
    low_angle = 1.0 - _normalize01(slope, 12.0, 28.0)
    local_low = minimum_filter(z, size=size, mode="nearest")
    channel_relief = np.maximum(z - local_low, 0.0)
    runout = np.clip(overhead * low_angle * (1.0 - 0.25 * _normalize01(channel_relief, 80.0, 250.0)), 0.0, 1.0)

    return [z, slope, aspect, profile, plan, rugged, release, overhead, runout]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dem", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target-resolution", type=float, default=None,
                        help="Optional output resolution in DEM CRS units (normally metres).")
    args = parser.parse_args()

    with rasterio.open(args.dem) as src:
        if src.crs is None or src.crs.is_geographic:
            raise SystemExit("DEM must use a projected metric CRS before terrain derivatives are calculated.")
        transform = src.transform
        width, height = src.width, src.height
        if args.target_resolution and abs(src.res[0] - args.target_resolution) > 1e-6:
            scale = src.res[0] / args.target_resolution
            width = int(round(src.width * scale))
            height = int(round(src.height * scale))
            z = src.read(1, out_shape=(height, width), resampling=Resampling.bilinear).astype("float64")
            transform = src.transform * src.transform.scale(src.width / width, src.height / height)
        else:
            z = src.read(1).astype("float64")
        mask = ~np.isfinite(z)
        if src.nodata is not None:
            mask |= np.isclose(z, src.nodata)
        if mask.any():
            # Derivatives require filled neighbourhoods. Use a conservative local
            # median surrogate for isolated gaps; the final output re-masks them.
            fill = float(np.nanmedian(np.where(mask, np.nan, z)))
            z[mask] = fill

        dx, dy = abs(transform.a), abs(transform.e)
        bands = terrain_features(z, dx, dy)
        profile = src.profile.copy()
        profile.update(driver="GTiff", dtype="float32", count=len(bands), width=width,
                       height=height, transform=transform, nodata=NODATA,
                       compress="DEFLATE", predictor=3, BIGTIFF="IF_SAFER")

        args.output.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(args.output, "w", **profile) as dst:
            names = ["elevation_m", "slope_deg", "aspect_deg", "profile_curvature",
                     "plan_curvature", "ruggedness_m", "release_area_score",
                     "connected_overhead_score", "runout_corridor_proxy"]
            for idx, (name, band) in enumerate(zip(names, bands), start=1):
                out = np.asarray(band, dtype="float32")
                out[mask] = NODATA
                dst.write(out, idx)
                dst.set_band_description(idx, name)
            dst.update_tags(
                purpose="experimental avalanche terrain feature preprocessing",
                warning="Not an avalanche forecast; release/runout scores are unvalidated screening proxies",
                source_dem=str(args.dem.name),
                cell_size_x_m=f"{dx:.3f}", cell_size_y_m=f"{dy:.3f}",
            )
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
