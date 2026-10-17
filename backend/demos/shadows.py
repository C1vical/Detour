"""Plot building shadows for a synthetic block at several times of day.

Run from the repo root:  python -m backend.demos.shadows
"""
from datetime import datetime, timedelta, timezone

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import box

from ..shadow import shadow_union
from ..sun import sun_position

LAT, LON = 40.0, -75.0
TZ = timezone(timedelta(hours=-5))  # US Eastern standard time
BUILDINGS = [
    (box(0, 0, 30, 20), 25.0),
    (box(50, 0, 70, 40), 40.0),
    (box(0, 40, 20, 60), 12.0),
    (box(40, 60, 80, 75), 18.0),
]
HOURS = [8, 10, 12, 14, 16]


def draw(ax, geom, **kw):
    for g in getattr(geom, "geoms", [geom]):
        if not g.is_empty:
            ax.fill(*g.exterior.xy, **kw)


def main() -> None:
    fig, axes = plt.subplots(1, len(HOURS), figsize=(4 * len(HOURS), 4.5), sharey=True)
    for ax, hour in zip(axes, HOURS):
        when = datetime(2026, 6, 21, hour, 0, tzinfo=TZ)
        sun = sun_position(LAT, LON, when)
        draw(ax, shadow_union(BUILDINGS, sun), color="0.55", alpha=0.6)
        for fp, _ in BUILDINGS:
            draw(ax, fp, color="tab:blue")
        ax.set_aspect("equal")
        ax.set_title(f"{hour}:00  el={sun.elevation:.0f}°  az={sun.azimuth:.0f}°")
    fig.suptitle("Building shadows, 21 June, lat 40°N")
    out = "shadow_demo.png"
    fig.savefig(out, dpi=100, bbox_inches="tight")
    print("wrote", out)


if __name__ == "__main__":
    main()
