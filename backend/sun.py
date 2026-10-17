"""Sun position: solar elevation and azimuth for a place and time.

Conventions used everywhere in the backend:
  elevation  theta: degrees above the horizon (0 = horizon, 90 = overhead)
  azimuth    alpha: degrees clockwise from north (90 = east, 180 = south)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd
from pvlib import solarposition


@dataclass(frozen=True)
class SunPosition:
    elevation: float  # degrees above horizon
    azimuth: float    # degrees clockwise from north

    @property
    def is_up(self) -> bool:
        return self.elevation > 0.0

    @property
    def intensity(self) -> float:
        """Relative clear-sky intensity I = max(0, sin(theta)), in [0, 1]."""
        return max(0.0, math.sin(math.radians(self.elevation)))


def _require_aware(when: datetime) -> None:
    if when.tzinfo is None:
        raise ValueError("`when` must be timezone-aware")


def sun_position(lat: float, lon: float, when: datetime) -> SunPosition:
    """Accurate sun position via pvlib (NREL SPA). `when` must be tz-aware."""
    _require_aware(when)
    sp = solarposition.get_solarposition(pd.DatetimeIndex([when]), lat, lon)
    return SunPosition(float(sp["apparent_elevation"].iloc[0]), float(sp["azimuth"].iloc[0]))


def sun_positions(lat: float, lon: float, times: pd.DatetimeIndex) -> pd.DataFrame:
    """Vectorised version: DataFrame with `elevation` and `azimuth` columns."""
    sp = solarposition.get_solarposition(times, lat, lon)
    return sp[["apparent_elevation", "azimuth"]].rename(columns={"apparent_elevation": "elevation"})


def sun_position_simple(lat: float, lon: float, when: datetime) -> SunPosition:
    """Textbook approximation, for understanding the math (accurate to ~1-2 degrees).

        declination  d = 23.44 * sin(360/365 * (284 + dayOfYear))
        hour angle   H = 15 * (solarTime - 12h)
        sin(theta)   = sin(phi) sin(d) + cos(phi) cos(d) cos(H)
        cos(alpha)   = (sin(d) - sin(theta) sin(phi)) / (cos(theta) cos(phi))
                       (alpha mirrored to 360 - alpha in the afternoon, H > 0)
    """
    _require_aware(when)
    utc = when.astimezone(timezone.utc)
    n = utc.timetuple().tm_yday
    decl = math.radians(23.44 * math.sin(math.radians(360.0 / 365.0 * (284 + n))))

    # Equation of time (minutes), then clock time -> solar time.
    b = math.radians(360.0 / 365.0 * (n - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    utc_hours = utc.hour + utc.minute / 60 + utc.second / 3600
    solar_time = utc_hours + lon / 15.0 + eot / 60.0
    hour_angle = math.radians(15.0 * (solar_time - 12.0))

    phi = math.radians(lat)
    sin_theta = math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(hour_angle)
    theta = math.asin(max(-1.0, min(1.0, sin_theta)))

    cos_alpha = (math.sin(decl) - sin_theta * math.sin(phi)) / (math.cos(theta) * math.cos(phi))
    alpha = math.degrees(math.acos(max(-1.0, min(1.0, cos_alpha))))
    if math.sin(hour_angle) > 0:  # afternoon: sun is in the west
        alpha = 360.0 - alpha
    return SunPosition(math.degrees(theta), alpha)
