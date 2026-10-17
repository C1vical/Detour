"""Sun position: solar elevation and azimuth for a place and time.

Conventions used everywhere in the backend:
  elevation  theta: degrees above the horizon (0 = horizon, 90 = overhead)
  azimuth    alpha: degrees clockwise from north (90 = east, 180 = south)

Positions come from pvlib (NREL SPA); times must be timezone-aware.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from pvlib import solarposition


@dataclass(frozen=True)
class SunPosition:
    elevation: float  # degrees above horizon
    azimuth: float    # degrees clockwise from north

    @property
    def is_up(self) -> bool:
        return self.elevation > 0.0


def sun_positions(lat: float, lon: float, times: pd.DatetimeIndex) -> pd.DataFrame:
    """Vectorised version: DataFrame with `elevation` and `azimuth` columns."""
    sp = solarposition.get_solarposition(times, lat, lon)
    return sp[["apparent_elevation", "azimuth"]].rename(columns={"apparent_elevation": "elevation"})

