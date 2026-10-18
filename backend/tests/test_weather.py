from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
import pytest

from backend import weather
from backend.weather import DayWeather, day_weather, rain_intensity

TZ = ZoneInfo("America/Toronto")


def _hourly(direct, cloud, rain):
    return {"time": [f"2026-06-21T{h:02d}:00" for h in range(24)],
            "direct_radiation": direct, "cloud_cover": cloud, "precipitation": rain}


def test_hourly_values_are_interpolated_to_the_minute():
    cloud = [h * 4.0 for h in range(24)]  # 0 %, 4 %, ... instantaneous at each hour
    w = DayWeather.from_hourly(_hourly([0.0] * 24, cloud, [0.0] * 24))
    assert w.at(datetime(2026, 6, 21, 10, 0, tzinfo=TZ))[1] == pytest.approx(0.40)
    assert w.at(datetime(2026, 6, 21, 10, 30, tzinfo=TZ))[1] == pytest.approx(0.42)


def test_hourly_averages_sit_at_the_middle_of_their_hour():
    # The 14:00 value is the 13:00-14:00 average, so it applies at 13:30.
    direct = [0.0] * 24
    direct[14] = 600.0
    w = DayWeather.from_hourly(_hourly(direct, [0.0] * 24, [0.0] * 24))
    assert w.at(datetime(2026, 6, 21, 13, 30, tzinfo=TZ))[0] == pytest.approx(600.0)
    assert w.at(datetime(2026, 6, 21, 14, 0, tzinfo=TZ))[0] == pytest.approx(300.0)


def test_incomplete_data_is_rejected():
    with pytest.raises(ValueError):
        DayWeather.from_hourly(_hourly([None] * 24, [0.0] * 24, [0.0] * 24))


def test_rain_intensity_saturates_at_moderate_rain():
    assert rain_intensity(2.0) == pytest.approx(0.5)
    assert rain_intensity(10.0) == 1.0


def test_fetch_failure_falls_back_to_none(monkeypatch):
    weather._cache.clear()

    def offline(*args, **kwargs):
        raise httpx.ConnectError("no network")

    monkeypatch.setattr(weather.httpx, "get", offline)
    assert day_weather(43.77, -79.50, date(2026, 6, 21)) is None


def test_forecast_response_is_parsed_and_cached(monkeypatch):
    weather._cache.clear()
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        body = {"hourly": _hourly([500.0] * 24, [20.0] * 24, [1.0] * 24)}
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(weather.httpx, "get", fake_get)
    w = day_weather(43.77, -79.50, date(2026, 6, 22))
    assert w.at(datetime(2026, 6, 22, 12, 0, tzinfo=TZ)) == pytest.approx((500.0, 0.2, 1.0))
    assert day_weather(43.77, -79.50, date(2026, 6, 22)) is w
    assert calls == [weather.FORECAST_URL]
