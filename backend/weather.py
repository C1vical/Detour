"""Hourly Open-Meteo weather for the campus (no API key): direct radiation sets the sun intensity,
precipitation the rain intensity; cloud cover is only shown in the UI."""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date as Date, datetime

import httpx
import numpy as np

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"   # about 3 months back to 16 days ahead
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"  # older dates
FIELDS = ("direct_radiation", "cloud_cover", "precipitation")
CACHE_SECONDS = 1800
RETRY_SECONDS = 60  # after a failed fetch, try again sooner
TIMEOUT_S = 5.0

_cache: dict[Date, tuple[float, DayWeather | None]] = {}


@dataclass
class DayWeather:
    """One local day at 1-minute resolution (index 0 = midnight)."""
    direct: np.ndarray  # W/m²
    cloud: np.ndarray   # 0-1
    rain: np.ndarray    # mm/h

    @classmethod
    def from_hourly(cls, hourly: dict) -> DayWeather:
        values = {f: np.asarray(hourly[f], dtype=float) for f in FIELDS}
        if any(len(v) != 24 or np.isnan(v).any() for v in values.values()):
            raise ValueError("incomplete hourly weather")
        minutes = np.arange(24 * 60 + 1)
        at_hour = np.arange(24) * 60.0
        mid_hour = at_hour - 30.0  # radiation and precipitation are averages over the preceding hour
        return cls(
            direct=np.interp(minutes, mid_hour, values["direct_radiation"]),
            cloud=np.interp(minutes, at_hour, values["cloud_cover"] / 100.0),
            rain=np.interp(minutes, mid_hour, values["precipitation"]),
        )

    def at(self, when: datetime) -> tuple[float, float, float]:
        """(direct W/m², cloud 0-1, rain mm/h) at `when`, to the minute."""
        i = min(when.hour * 60 + when.minute, len(self.direct) - 1)
        return float(self.direct[i]), float(self.cloud[i]), float(self.rain[i])


def _fetch(url: str, lat: float, lon: float, day: Date) -> DayWeather:
    r = httpx.get(url, timeout=TIMEOUT_S, params={
        "latitude": lat, "longitude": lon, "hourly": ",".join(FIELDS),
        "timezone": "America/Toronto", "start_date": day.isoformat(), "end_date": day.isoformat(),
    })
    r.raise_for_status()
    return DayWeather.from_hourly(r.json()["hourly"])


def day_weather(lat: float, lon: float, day: Date) -> DayWeather | None:
    """Weather for `day`, cached for 30 minutes; None if Open-Meteo can't be reached."""
    hit = _cache.get(day)
    if hit and time.time() - hit[0] < (CACHE_SECONDS if hit[1] else RETRY_SECONDS):
        return hit[1]
    weather = None
    for url in (FORECAST_URL, ARCHIVE_URL):
        try:
            weather = _fetch(url, lat, lon, day)
            break
        except (httpx.HTTPError, KeyError, ValueError):
            continue
    _cache[day] = (time.time(), weather)
    return weather


def rain_intensity(rain_mm_h: np.ndarray) -> np.ndarray:
    """Relative rain intensity R in [0, 1]: 4 mm/h (moderate rain) or more counts as 1."""
    return np.minimum(1.0, np.asarray(rain_mm_h) / 4.0)
