import Image from "next/image";

import CampusMapLoader from "@/components/CampusMapLoader";

export default function Home() {
  return (
    <main className="map-shell">
      <header className="map-header">
        <div className="brand">
          <div className="brand-text">
            <h1 className="wordmark">
              <Image
                src="/detour-wordmark-transparent.png"
                alt="Detour"
                width={2048}
                height={925}
                sizes="120px"
                preload
              />
            </h1>
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
