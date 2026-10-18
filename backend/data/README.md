# Toronto 3D Massing building heights

`york_building_heights.geojson` is a
checked-in snapshot of the City of Toronto's **2025 3D Massing WGS84**
shapefile. It contains 737 footprints intersecting the Keele campus or its
300 m shadow buffer.

The backend uses `MAX_HEIGHT` as `height_m` so the shadow model uses the
highest observed roof point for each footprint. The original `HEIGHT_SRC`
value is preserved as `height_data_source`; `height_source` is set to
`toronto_3d_massing_2025`.

The Toronto dataset is provided for information and illustrative purposes and
must be verified for legal or official use.
