import CampusMapLoader from "@/components/CampusMapLoader";

export default function Home() {
  return (
    <main className="map-shell">
      <header className="map-header">
        <div>
          <p className="eyebrow">ShadeRoute</p>
          <h1>York University Keele Campus</h1>
        </div>
        <p className="map-status">Interactive campus map</p>
      </header>
      <section aria-label="York University Keele Campus map" className="map-region">
        <CampusMapLoader />
        <div className="map-intro">
          <p className="eyebrow">Step 1</p>
          <p>Select the map points you want to use as your route endpoints.</p>
        </div>
      </section>
    </main>
  );
}
