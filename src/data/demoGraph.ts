import type { Edge, Graph } from "@/lib/routing/types";

// Demo campus with 3 real routes from "start" to "destination":
//
//   A. Quad (fastest, 180 s)       — wide open: very sunny AND rainy
//   B. Tree Lane (200 s)           — shaded by trees, but rain gets through
//   C. Covered Walkway (260 s)     — library arcade: sheltered from sun and rain
//
// Plus two tempting shortcuts that must NEVER be used:
//   - a direct path closed for construction (120 s)
//   - a highway with no sidewalk, not walkable (120 s)
//
// Expected results:  Fastest → A,  Stay Cool → B,  Stay Dry → C

// Small helper so every edge is open/walkable unless we say otherwise.
function edge(e: Omit<Edge, "walkable" | "constructionClosed"> & Partial<Edge>): Edge {
  return { walkable: true, constructionClosed: false, ...e };
}

export const demoGraph: Graph = {
  nodes: [
    { id: "start", name: "Dorms", x: 0, y: 0, elevation: 100 },
    { id: "quad", name: "Main Quad", x: 1, y: 1, elevation: 102 },
    { id: "treeLane", name: "Tree Lane", x: 1, y: -0.5, elevation: 101 },
    { id: "library", name: "Library Arcade", x: 1, y: -1.5, elevation: 101 },
    { id: "highway", name: "Highway Overpass", x: 1, y: 2, elevation: 104 },
    { id: "destination", name: "Science Hall", x: 2, y: 0, elevation: 103 },
  ],

  edges: [
    // Route A: open quad
    edge({
      id: "start-quad", from: "start", to: "quad",
      distance: 120, walkingTime: 90,
      sunExposure: 0.85, rainExposure: 0.9, elevationEffort: 0.25,
    }),
    edge({
      id: "quad-destination", from: "quad", to: "destination",
      distance: 120, walkingTime: 90,
      sunExposure: 0.8, rainExposure: 0.85, elevationEffort: 0.25,
    }),

    // Route B: shaded tree lane
    edge({
      id: "start-treeLane", from: "start", to: "treeLane",
      distance: 133, walkingTime: 100,
      sunExposure: 0.15, rainExposure: 0.7, elevationEffort: 0.2,
    }),
    edge({
      id: "treeLane-destination", from: "treeLane", to: "destination",
      distance: 133, walkingTime: 100,
      sunExposure: 0.15, rainExposure: 0.7, elevationEffort: 0.2,
    }),

    // Route C: covered library walkway
    edge({
      id: "start-library", from: "start", to: "library",
      distance: 173, walkingTime: 130,
      sunExposure: 0.1, rainExposure: 0.05, elevationEffort: 0.15,
    }),
    edge({
      id: "library-destination", from: "library", to: "destination",
      distance: 173, walkingTime: 130,
      sunExposure: 0.1, rainExposure: 0.05, elevationEffort: 0.15,
    }),

    // Closed shortcut: would be the best route if it were open.
    edge({
      id: "start-destination-shortcut", from: "start", to: "destination",
      distance: 160, walkingTime: 120,
      sunExposure: 0.1, rainExposure: 0.1, elevationEffort: 0.1,
      constructionClosed: true,
    }),

    // Highway: no sidewalk, not walkable.
    edge({
      id: "start-highway", from: "start", to: "highway",
      distance: 80, walkingTime: 60,
      sunExposure: 0.1, rainExposure: 0.1, elevationEffort: 0.1,
      walkable: false,
    }),
    edge({
      id: "highway-destination", from: "highway", to: "destination",
      distance: 80, walkingTime: 60,
      sunExposure: 0.1, rainExposure: 0.1, elevationEffort: 0.1,
      walkable: false,
    }),
  ],
};
