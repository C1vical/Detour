import CampusMapLoader from "@/components/CampusMapLoader";

export default function Home() {
  return (
    <main className="map-shell">
      <header className="map-header">
        <div>
          <p className="eyebrow">ShadeRoute</p>
          <h1>York University Keele Campus</h1>
        </div>
        <p className="map-status">Sun-aware routing</p>
      </header>
      <section aria-label="York University Keele Campus map" className="map-region">
        <CampusMapLoader />
      </section>
    </main>
  );
}
