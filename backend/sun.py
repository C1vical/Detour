"""Sun position from pvlib (NREL SPA): elevation in degrees above the horizon, azimuth in degrees
clockwise from north (90 = east, 180 = south)."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from pvlib import solarposition


@dataclass(frozen=True)
class SunPosition:
    elevation: float
    azimuth: float

    @property
    def is_up(self) -> bool:
        return self.elevation > 0.0


def sun_positions(lat: float, lon: float, times: pd.DatetimeIndex) -> pd.DataFrame:
    """`elevation` (apparent, with refraction) and `azimuth` columns for timezone-aware `times`."""
    sp = solarposition.get_solarposition(times, lat, lon)
    return sp[["apparent_elevation", "azimuth"]].rename(columns={"apparent_elevation": "elevation"})
