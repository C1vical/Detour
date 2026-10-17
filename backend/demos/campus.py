"""Plot real York campus shadows (OSM buildings) over the walk network.

Run from the repo root:  python -m backend.demos.campus [YYYY-MM-DD]
"""
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import osmnx as ox

from ..data import CAMPUS_CENTER, building_list, load_campus, tree_list
from ..shadow import shadow_union
from ..sun import sun_position

TZ = ZoneInfo("America/Toronto")
HOURS = [9, 12, 15, 18]


def draw(ax, geom, **kw):
    for g in getattr(geom, "geoms", [geom]):
        if not g.is_empty and g.geom_type == "Polygon":
            ax.fill(*g.exterior.xy, **kw)


def main() -> None:
    date = sys.argv[1] if len(sys.argv) > 1 else "2026-06-21"
    year, month, day = map(int, date.split("-"))
    data = load_campus()
    buildings = building_list(data)
    minx, miny, maxx, maxy = data.campus.buffer(50).bounds
    lat, lon = CAMPUS_CENTER

    fig, axes = plt.subplots(1, len(HOURS), figsize=(6 * len(HOURS), 6))
    for ax, hour in zip(axes, HOURS):
        when = datetime(year, month, day, hour, 0, tzinfo=TZ)
        sun = sun_position(lat, lon, when)
        ox.plot_graph(data.graph, ax=ax, show=False, close=False, node_size=0,
                      edge_color="tab:green", edge_linewidth=0.8, bgcolor="white")
        draw(ax, shadow_union(buildings, sun, tree_list(data)), color="0.4", alpha=0.45)
        for fp, _ in buildings:
            draw(ax, fp, color="tab:blue", alpha=0.9)
        ax.plot(*data.campus.exterior.xy, color="tab:red", lw=1)
        ax.set_xlim(minx, maxx)
        ax.set_ylim(miny, maxy)
        ax.set_title(f"{hour}:00  el={sun.elevation:.0f}°  az={sun.azimuth:.0f}°")
    fig.suptitle(f"York University (Keele) shadows, {date}")
    out = "campus_shadows.png"
    fig.savefig(out, dpi=90, bbox_inches="tight")
    print("wrote", out)


if __name__ == "__main__":
    main()
