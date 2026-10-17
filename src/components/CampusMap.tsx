"use client";

import {
  MapContainer,
  ScaleControl,
  TileLayer,
  ZoomControl,
} from "react-leaflet";

const KEELE_CAMPUS_CENTER: [number, number] = [43.7735, -79.5019];

export default function CampusMap() {
  return (
    <MapContainer
      center={KEELE_CAMPUS_CENTER}
      className="campus-map"
      scrollWheelZoom
      zoom={16}
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="topright" />
      <ScaleControl position="bottomleft" />
    </MapContainer>
  );
}
