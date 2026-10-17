"""Compare the fastest route with the sun-aware route across York's Keele campus.

Run from the repo root:
    python -m backend.demo_route [YYYY-MM-DD] [HH:MM] [w_sun]
e.g. python -m backend.demo_route 2026-06-21 14:00 3
"""
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import osmnx as ox

from .data import CAMPUS_CENTER, METRIC_CRS, building_list, load_campus
from .exposure import ExposureModel, SunSchedule
from .router import compare
from .shadow import shadow_union

TZ = ZoneInfo("America/Toronto")
# (lat, lon) of the demo trip: south-west of campus to the north-east.
ORIGIN = (43.7715, -79.5100)
DEST = (43.7790, -79.4960)


def nearest_node(graph, latlon):
    pt = gpd.GeoSeries.from_xy([latlon[1]], [latlon[0]], crs="EPSG:4326").to_crs(METRIC_CRS).iloc[0]
    return ox.distance.nearest_nodes(graph, pt.x, pt.y)


def fmt(seconds: float) -> str:
    return f"{int(seconds // 60)} min {int(round(seconds % 60)):02d} sec"


def draw(ax, geom, **kw):
    for g in getattr(geom, "geoms", [geom]):
        if not g.is_empty and g.geom_type == "Polygon":
            ax.fill(*g.exterior.xy, **kw)


def main() -> None:
    date = sys.argv[1] if len(sys.argv) > 1 else "2026-06-21"
    clock = sys.argv[2] if len(sys.argv) > 2 else "14:00"
    w_sun = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
    y, m, d = map(int, date.split("-"))
    hh, mm = map(int, clock.split(":"))
    start = datetime(y, m, d, hh, mm, tzinfo=TZ)

    data = load_campus()
    model = ExposureModel(data, SunSchedule(*CAMPUS_CENTER, start))
    a, b = nearest_node(data.graph, ORIGIN), nearest_node(data.graph, DEST)
    fast, ctx = compare(model, a, b, start, w_sun)

    print(f"{start:%Y-%m-%d %H:%M}   w_sun = {w_sun}")
    for label, r in (("FASTEST", fast), ("CONTEXTROUTE", ctx)):
        print(f"{label:13s} {fmt(r.seconds)}  {r.distance_m:.0f} m  sun exposure {r.sun_percent:.0f}%"
              f"  (A* expanded {r.expanded} nodes)")
    print(f"+{ctx.seconds - fast.seconds:.0f} sec, "
          f"{100 * (ctx.sun_percent - fast.sun_percent) / max(fast.sun_percent, 1e-9):+.0f}% sun exposure")

    fig, ax = plt.subplots(figsize=(11, 9))
    ox.plot_graph(data.graph, ax=ax, show=False, close=False, node_size=0,
                  edge_color="0.8", edge_linewidth=0.6, bgcolor="white")
    draw(ax, shadow_union(building_list(data), model.sun.position(start)), color="0.4", alpha=0.35)
    for fp, _ in building_list(data):
        draw(ax, fp, color="tab:blue", alpha=0.5)
    for r, color, lab in ((fast, "tab:red", "Fastest"), (ctx, "tab:green", "ContextRoute")):
        xs = [data.graph.nodes[n]["x"] for n in r.nodes]
        ys = [data.graph.nodes[n]["y"] for n in r.nodes]
        ax.plot(xs, ys, color=color, lw=3, label=f"{lab}: {fmt(r.seconds)}, {r.sun_percent:.0f}% sun")
    minx, miny, maxx, maxy = data.campus.buffer(50).bounds
    ax.set_xlim(minx, maxx); ax.set_ylim(miny, maxy)
    ax.legend(loc="lower right")
    ax.set_title(f"Keele campus routes, {start:%Y-%m-%d %H:%M}")
    fig.savefig("route_demo.png", dpi=90, bbox_inches="tight")
    print("wrote route_demo.png")


if __name__ == "__main__":
    main()
