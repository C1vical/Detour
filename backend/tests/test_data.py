from backend.data import MASSING_FILE, METRIC_CRS, _load_massing_buildings


def test_toronto_massing_snapshot_provides_building_heights():
    assert MASSING_FILE.exists()

    buildings = _load_massing_buildings()

    assert len(buildings) == 737
    assert buildings.crs.to_string() == METRIC_CRS
    assert set(buildings["height_source"]) == {"toronto_3d_massing_2025"}
    assert buildings["height_m"].max() == 61.537
    assert buildings["height_data_source"].notna().all()
    assert not buildings.geometry.has_z.any()
