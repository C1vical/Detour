import pytest
from fastapi.testclient import TestClient

from backend.data import CACHE_DIR

pytestmark = pytest.mark.skipif(not (CACHE_DIR / "walk.graphml").exists(), reason="campus cache not downloaded")


@pytest.fixture(scope="module")
def client():
    from backend.api import app
    with TestClient(app) as c:  # runs lifespan (loads campus)
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["edges"] > 1000


def test_route_shape_and_tradeoff(client):
    r = client.get("/route", params={"date": "2026-06-21", "time": "14:00", "w_sun": 3})
    assert r.status_code == 200
    j = r.json()
    assert j["fastest"]["geometry"]["type"] == "LineString"
    lon, lat = j["fastest"]["geometry"]["coordinates"][0]
    assert -80 < lon < -79 and 43 < lat < 44  # GeoJSON order is [lon, lat]
    assert j["contextroute"]["seconds"] >= j["fastest"]["seconds"]
    assert j["contextroute"]["sun_percent"] <= j["fastest"]["sun_percent"]


def test_time_of_day_changes_result(client):
    day = client.get("/route", params={"date": "2026-06-21", "time": "14:00"}).json()
    night = client.get("/route", params={"date": "2026-06-21", "time": "02:00"}).json()
    assert day["sun"]["is_daylight"] and not night["sun"]["is_daylight"]
    assert night["extra_seconds"] == 0  # no sun, nothing to avoid
    assert night["fastest"]["sun_percent"] == 0


def test_zero_weight_equals_fastest(client):
    j = client.get("/route", params={"date": "2026-06-21", "time": "14:00", "w_sun": 0}).json()
    assert j["fastest"]["geometry"] == j["contextroute"]["geometry"]


def test_validation(client):
    assert client.get("/route", params={"time": "25:99"}).status_code == 422
    assert client.get("/route", params={"w_sun": -1}).status_code == 422


def test_shadows_geojson(client):
    j = client.get("/shadows", params={"date": "2026-12-21", "time": "15:00"}).json()
    assert j["type"] == "FeatureCollection" and len(j["features"]) == 1
    night = client.get("/shadows", params={"date": "2026-12-21", "time": "02:00"}).json()
    assert night["features"] == []


def test_custom_endpoints(client):
    p = {"date": "2026-06-21", "time": "14:00", "from_lat": 43.7735, "from_lon": -79.5019,
         "to_lat": 43.7790, "to_lon": -79.4960}
    j = client.get("/route", params=p).json()
    assert j["origin"] == [43.7735, -79.5019] and j["destination"] == [43.779, -79.496]
    assert j["fastest"]["geometry"]["type"] == "LineString"


def test_endpoint_validation(client):
    assert client.get("/route", params={"from_lat": 43.77}).status_code == 422  # lon missing
    far = {"to_lat": 44.5, "to_lon": -79.0}
    assert client.get("/route", params=far).status_code == 422  # off the network
