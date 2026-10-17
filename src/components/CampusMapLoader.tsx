"use client";

import dynamic from "next/dynamic";

const CampusMap = dynamic(() => import("./CampusMap"), {
  ssr: false,
  loading: () => <div aria-label="Loading map" className="campus-map" />,
});

export default function CampusMapLoader() {
  return <CampusMap />;
}
