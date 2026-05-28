"use client";

import { useEffect, useRef, useState } from "react";

export interface MapMarker {
  id: string;
  address: string;
  community: string | null;
  lat: number;
  lng: number;
  score: number | null;
  recommendation: string | null;
  status: string | null;
  price: string | null;
}

// Pin color by recommendation (mirrors the badge palette in lib/ui).
function pinColor(rec: string | null, score: number | null): string {
  switch (rec) {
    case "Strong candidate":
      return "#16a34a"; // green-600
    case "Good option":
      return "#65a30d"; // lime-600
    case "Maybe":
      return "#d97706"; // amber-600
    case "Pass":
    case "Pass / must-have issue":
      return "#dc2626"; // red-600
    default:
      return score == null ? "#94a3b8" : "#475569"; // slate
  }
}

// Inline SVG teardrop pin as a data URL, colored per recommendation.
function pinIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 26 14 26s14-16.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}"/>
    <circle cx="14" cy="14" r="6" fill="#ffffff"/>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

// Load the Google Maps JS API once, sharing a single promise across mounts.
let mapsPromise: Promise<void> | null = null;
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) {
    return Promise.resolve();
  }
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(apiKey);
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}

export default function MapView({
  markers,
  apiKey,
}: {
  markers: MapMarker[];
  apiKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMaps(apiKey)
      .then(() => {
        if (cancelled || !ref.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        const map = new g.maps.Map(ref.current, {
          mapTypeControl: false,
          streetViewControl: false,
          zoom: 10,
          center: { lat: markers[0]?.lat ?? 35.5, lng: markers[0]?.lng ?? -80.5 },
        });
        const bounds = new g.maps.LatLngBounds();
        const info = new g.maps.InfoWindow();

        for (const m of markers) {
          const pos = { lat: m.lat, lng: m.lng };
          bounds.extend(pos);
          const marker = new g.maps.Marker({
            position: pos,
            map,
            title: m.address,
            icon: {
              url: pinIcon(pinColor(m.recommendation, m.score)),
              scaledSize: new g.maps.Size(28, 40),
              anchor: new g.maps.Point(14, 40),
            },
          });
          marker.addListener("click", () => {
            info.setContent(infoHtml(m));
            info.open({ anchor: marker, map });
          });
        }

        if (markers.length > 1) {
          map.fitBounds(bounds, 64);
        } else if (markers.length === 1) {
          map.setCenter({ lat: markers[0].lat, lng: markers[0].lng });
          map.setZoom(13);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load Google Maps.");
      });
    return () => {
      cancelled = true;
    };
  }, [markers, apiKey]);

  if (error) {
    return (
      <div className="card text-sm text-red-700">{error}</div>
    );
  }

  return (
    <div
      ref={ref}
      className="h-[70vh] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
    />
  );
}

function infoHtml(m: MapMarker): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ] as string),
    );
  const lines: string[] = [];
  lines.push(
    `<a href="/properties/${m.id}" style="font-weight:600;color:#2563eb;text-decoration:none">${esc(
      m.address,
    )}</a>`,
  );
  if (m.community) {
    lines.push(`<div style="color:#64748b">${esc(m.community)}</div>`);
  }
  const bits: string[] = [];
  if (m.score != null) bits.push(`Score ${Math.round(m.score * 10) / 10}`);
  if (m.recommendation) bits.push(esc(m.recommendation));
  if (m.status) bits.push(esc(m.status));
  if (bits.length) {
    lines.push(`<div style="margin-top:2px">${bits.join(" · ")}</div>`);
  }
  return `<div style="font:13px system-ui,sans-serif;min-width:160px">${lines.join(
    "",
  )}</div>`;
}
