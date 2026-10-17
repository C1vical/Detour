import CampusMapLoader from "@/components/CampusMapLoader";
import { LogoMark } from "@/components/PanelControls";

export default function Home() {
  return (
    <main className="map-shell">
      <header className="map-header">
        <div className="brand">
          <LogoMark />
          <div className="brand-text">
            <h1>Detour</h1>
            <p className="slogan">Walk the cool way.</p>
          </div>
        </div>
        <p className="map-context">York University · Keele Campus</p>
      </header>
      <section aria-label="York University Keele Campus map" className="map-region">
        <CampusMapLoader />
      </section>
    </main>
  );
}
