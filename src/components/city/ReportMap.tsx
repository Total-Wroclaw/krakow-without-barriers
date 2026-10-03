'use client';
import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

const STYLE = 'https://tiles.openfreemap.org/styles/positron';

/** Small locator map for one report. Coordinates and map links are always shown next to it as text. */
export default function ReportMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    import('maplibre-gl').then(maplibregl => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      map = new maplibregl.Map({ container: container.current, style: STYLE, center: [lon, lat], zoom: 17, attributionControl: { compact: true } });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      new maplibregl.Marker({ color: '#c4122f' }).setLngLat([lon, lat]).addTo(map);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lon]);
  return <div ref={container} role="region" aria-label={label} className="h-56 w-full overflow-hidden rounded-lg border bg-muted" />;
}
