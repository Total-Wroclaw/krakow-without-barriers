'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Marker } from 'maplibre-gl';
import { LoaderCircle, LocateFixed, Map as MapIcon, Minus, Plus, Satellite } from 'lucide-react';
import { toast } from 'sonner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CityFact, CityPlace } from '@/lib/city-types';
import type { PlaceObjectSummary } from '@/lib/explore-types';
import { useI18n } from '@/lib/i18n/client';
import type { JourneyOption } from '@/lib/journey-types';
import type { Report } from '@/lib/schemas';
import { allFacts, factTitle } from '@/lib/journey-ui';
import { useReportTitle } from './Reports';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
// Official Polish orthophoto (GUGiK), free reuse with attribution, served through our disk-cached tile proxy.
const orthoTiles = () => `${window.location.origin}/api/tiles/ortho/{z}/{x}/{y}`;
const KRAKOW: [number, number] = [19.945, 50.061];
const colors = { walk: '#14213d', tram: '#c4122f', bus: '#2443b0', drive: '#0e6c80' };

const icons = {
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  unknown: '<circle cx="12" cy="12" r="3"/>',
  bench: '<path d="M4 12h16M6 12v6M18 12v6M6 8h12"/>',
  entrance: '<path d="M13 4h5v16h-5M3 12h10M9 8l4 4-4 4"/>',
  report: '<path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
  toilet: '<path d="M7 4h2v4H7zM15 4h2v4h-2zM6 10h5v10H6zM14 10h4l-1 10h-2z"/>',
  kerb: '<path d="M4 18h6v-6h10"/>',
  surface: '<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>',
};

function markerElement(label: string, icon: string, background: string, size = 30) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'map-marker';
  el.setAttribute('aria-label', label);
  el.title = label;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;background:${background};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(20,33,61,.45);display:grid;place-items:center;cursor:pointer;padding:0`;
  el.innerHTML = `<svg width="${size * 0.55}" height="${size * 0.55}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
  return el;
}

function endpointElement(kind: 'start' | 'end', label: string) {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.style.cssText =
    kind === 'start'
      ? 'width:18px;height:18px;border-radius:999px;background:#fff;border:5px solid #14213d;box-shadow:0 1px 4px rgba(0,0,0,.35)'
      : 'width:22px;height:22px;border-radius:999px 999px 999px 0;transform:rotate(-45deg);background:#2443b0;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)';
  return el;
}

type Props = {
  options: JourneyOption[];
  selectedId: string | null;
  from: CityPlace | null;
  to: CityPlace | null;
  reports: Report[];
  objects?: PlaceObjectSummary[];
  selectedObjectId?: string | null;
  onSelect: (id: string) => void;
  onFact: (fact: CityFact) => void;
  onReport: (report: Report) => void;
  onObject?: (id: string) => void;
  onMove?: (center: { lat: number; lon: number }) => void;
};

export default function MapView({ options, selectedId, from, to, reports, objects = [], selectedObjectId, onSelect, onFact, onReport, onObject, onMove }: Props) {
  const { t, tp } = useI18n();
  const reportTitle = useReportTitle();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<Marker[]>([]);
  const [base, setBase] = useState<'standard' | 'satellite'>('standard');
  const latest = useRef({ onSelect, onFact, onReport, onObject, onMove });
  latest.current = { onSelect, onFact, onReport, onObject, onMove };
  const render = useRef<() => void>(() => {});
  const lastView = useRef('');
  const userMarker = useRef<Marker | null>(null);
  const watchId = useRef<number | null>(null);
  const userPos = useRef<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);

  /** Keeps a "you are here" dot up to date. Never moves the camera on its own. */
  function watchPosition() {
    if (watchId.current !== null || !navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(
      p => {
        userPos.current = { lat: p.coords.latitude, lon: p.coords.longitude };
        const instance = map.current;
        if (!instance) return;
        if (!userMarker.current) {
          const el = document.createElement('div');
          el.setAttribute('role', 'img');
          el.setAttribute('aria-label', t('map.you'));
          el.style.cssText = 'width:18px;height:18px;border-radius:999px;background:#2443b0;border:3px solid #fff;box-shadow:0 0 0 6px rgba(36,67,176,.22),0 1px 4px rgba(0,0,0,.35)';
          userMarker.current = new maplibregl.Marker({ element: el }).setLngLat([p.coords.longitude, p.coords.latitude]).addTo(instance);
        } else userMarker.current.setLngLat([p.coords.longitude, p.coords.latitude]);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
  }

  /** Explicit "show my location": asks permission if needed, then centres once. */
  function locate() {
    if (!navigator.geolocation) {
      toast.error(t('search.noGeo'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        setLocating(false);
        userPos.current = { lat: p.coords.latitude, lon: p.coords.longitude };
        watchPosition();
        map.current?.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.current.getZoom(), 16), duration: 600 });
      },
      () => {
        setLocating(false);
        toast.error(t('search.geoDenied'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    );
  }

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    },
    [],
  );

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: KRAKOW,
      zoom: 12.3,
      attributionControl: { compact: true },
      // Control labels in the interface language; the canvas carries the single map landmark.
      locale: {
        'NavigationControl.ZoomIn': t('map.zoomIn'),
        'NavigationControl.ZoomOut': t('map.zoomOut'),
        'GeolocateControl.FindMyLocation': t('map.locate'),
        'GeolocateControl.LocationNotAvailable': t('search.geoFailed'),
        'AttributionControl.ToggleAttribution': t('map.attribution'),
        'Map.Title': t('map.region'),
      },
    });
    // Start with the attribution collapsed on narrow screens; it stays one tap away.
    instance.once('load', () => {
      if (window.innerWidth < 640) container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    });
    // If location is already allowed, show where the person is (without moving the map).
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then(status => status.state === 'granted' && watchPosition())
      .catch(() => {});
    const minor = () => container.current?.classList.toggle('hide-minor', instance.getZoom() < 15);
    instance.on('zoomend', minor);
    instance.on('load', () => {
      minor();
      // Satellite sits under the labels of the base style so street names stay readable.
      const firstSymbol = instance.getStyle().layers.find(l => l.type === 'symbol')?.id;
      instance.addSource('ortho', { type: 'raster', tiles: [orthoTiles()], tileSize: 256, minzoom: 8, maxzoom: 19, attribution: '© <a href="https://www.geoportal.gov.pl">GUGiK</a>' });
      instance.addLayer({ id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'routes-other', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7d879c', 'line-width': 5, 'line-opacity': 0.6 } });
      instance.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
      instance.addLayer({ id: 'routes-vehicle', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'selected'], true], ['!=', ['get', 'kind'], 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'tram', colors.tram, 'drive', colors.drive, colors.bus], 'line-width': 6 } });
      instance.addLayer({ id: 'routes-walk', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'selected'], true], ['==', ['get', 'kind'], 'walk']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.walk, 'line-width': 5, 'line-dasharray': [0.1, 1.8] } });
      // Places are drawn on the canvas (the list next to the map is their accessible equivalent).
      instance.addSource('objects', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      instance.addLayer({ id: 'objects', type: 'circle', source: 'objects', paint: {
        'circle-radius': ['case', ['get', 'selected'], 12, ['get', 'promoted'], 10, 8],
        'circle-color': ['case', ['get', 'selected'], '#2443b0', ['get', 'promoted'], '#a1460a', '#7a3e9d'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
      } });
      instance.on('click', 'objects', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') latest.current.onObject?.(id);
      });
      instance.on('mouseenter', 'objects', () => (instance.getCanvas().style.cursor = 'pointer'));
      instance.on('mouseleave', 'objects', () => (instance.getCanvas().style.cursor = ''));
      instance.on('click', 'routes-other', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.option;
        if (typeof id === 'string') latest.current.onSelect(id);
      });
      instance.on('mouseenter', 'routes-other', () => (instance.getCanvas().style.cursor = 'pointer'));
      instance.on('mouseleave', 'routes-other', () => (instance.getCanvas().style.cursor = ''));
      ready.current = true;
      render.current();
    });
    instance.on('moveend', () => {
      const c = instance.getCenter();
      latest.current.onMove?.({ lat: c.lat, lon: c.lng });
    });
    map.current = instance;
    return () => {
      ready.current = false;
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    instance.setLayoutProperty('ortho', 'visibility', base === 'satellite' ? 'visible' : 'none');
  }, [base]);

  useEffect(() => {
    render.current = () => {
      const instance = map.current;
      if (!instance || !ready.current) return;
      instance.setLayoutProperty('ortho', 'visibility', base === 'satellite' ? 'visible' : 'none');
      const features = options.flatMap(option =>
        option.legs.map(leg => ({
          type: 'Feature' as const,
          properties: { option: option.id, selected: option.id === selectedId, kind: leg.type === 'walk' ? 'walk' : leg.type === 'drive' ? 'drive' : leg.mode },
          geometry: { type: 'LineString' as const, coordinates: leg.geometry.map(([lat, lon]) => [lon, lat]) },
        })),
      );
      // Selected route draws last so it sits on top.
      features.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected));
      (instance.getSource('routes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });

      markers.current.forEach(m => m.remove());
      markers.current = [];
      const add = (el: HTMLElement, lat: number, lon: number) => markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(instance));

      const selected = options.find(o => o.id === selectedId);
      if (selected) {
        for (const fact of allFacts(selected)) {
          const icon = fact.kind === 'toilet' ? icons.toilet : fact.kind === 'bench' ? icons.bench : fact.kind === 'entrance' ? icons.entrance : fact.kind === 'kerb' ? icons.kerb : fact.kind === 'surface' ? icons.surface : icons[fact.direction];
          const bg = fact.kind === 'toilet' ? '#2443b0' : fact.kind === 'bench' ? '#0f766e' : fact.kind === 'entrance' ? '#2443b0' : '#a1460a';
          const el = markerElement(factTitle(fact, t, tp), icon, bg, fact.kind === 'stairs' ? 34 : 30);
          // Stairs always show; benches and entrances only once zoomed in, to avoid clutter.
          if (fact.kind !== 'stairs' && fact.kind !== 'kerb' && fact.kind !== 'toilet' && !fact.restAfterMinutes) el.classList.add('map-minor');
          el.addEventListener('click', () => latest.current.onFact(fact));
          add(el, fact.lat, fact.lon);
        }
        for (const leg of selected.legs) {
          if (leg.type !== 'drive' || !leg.parking) continue;
          const el = markerElement(t('option.parking', { name: leg.parking.name }), '<path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>', '#0e6c80', 30);
          el.tabIndex = -1;
          add(el, leg.parking.lat, leg.parking.lon);
        }
      }
      for (const report of reports) {
        if (!report.location) continue;
        const el = markerElement(t('report.markerLabel', { title: reportTitle(report) }), icons.report, '#6d28d9', 28);
        el.addEventListener('click', () => latest.current.onReport(report));
        add(el, report.location.lat, report.location.lon);
      }
      (instance.getSource('objects') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: objects.map(o => ({
          type: 'Feature' as const,
          properties: { id: o.id, selected: o.id === selectedObjectId, promoted: !!o.partner?.promoted },
          geometry: { type: 'Point' as const, coordinates: [o.lon, o.lat] },
        })),
      });
      if (from) add(endpointElement('start', t('map.start', { name: from.name })), from.lat, from.lon);
      if (to) add(endpointElement('end', t('map.goal', { name: to.name })), to.lat, to.lon);

      // Only move the camera when what is shown changes — not on a base-map or language switch,
      // so a user's own zoom is kept.
      const viewKey = JSON.stringify([selectedId, from?.lat, from?.lon, to?.lat, to?.lon, selectedObjectId, objects[0]?.id ?? null, selected ? 1 : 0]);
      if (viewKey === lastView.current) return;
      lastView.current = viewKey;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const chosenObject = objects.find(o => o.id === selectedObjectId);
      if (chosenObject) {
        instance.easeTo({ center: [chosenObject.lon, chosenObject.lat], zoom: Math.max(instance.getZoom(), 16), duration: reduce ? 0 : 600 });
        return;
      }
      const points: [number, number][] = selected
        ? selected.legs.flatMap(l => l.geometry)
        : objects.length
          ? objects.map(o => [o.lat, o.lon])
          : [];
      if (from) points.push([from.lat, from.lon]);
      if (to) points.push([to.lat, to.lon]);
      if (points.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        points.forEach(([lat, lon]) => bounds.extend([lon, lat]));
        instance.fitBounds(bounds, { padding: { top: 70, bottom: 50, left: 50, right: 70 }, maxZoom: 17, duration: reduce ? 0 : 600 });
      } else if (points.length === 1) {
        instance.easeTo({ center: [points[0][1], points[0][0]], zoom: 15, duration: reduce ? 0 : 600 });
      }
    };
    render.current();
  }, [options, selectedId, from, to, reports, objects, selectedObjectId, t, tp, reportTitle, base]);

  const control = 'grid size-11 place-items-center text-foreground transition-colors hover:bg-accent disabled:opacity-50';
  return (
    <div className="relative size-full">
      <div ref={container} className="size-full" />
      {/* Map controls in the app's own style; one column, top-right, 44 px targets. */}
      <div className="absolute right-2.5 top-2.5 z-10 flex flex-col items-end gap-2">
        <ToggleGroup
          type="single"
          value={base}
          onValueChange={v => v && setBase(v as 'standard' | 'satellite')}
          aria-label={t('map.style')}
          className="rounded-lg border bg-card p-0.5 shadow-sm"
        >
          <ToggleGroupItem value="standard" className="h-10 gap-1 px-2.5 text-sm" aria-label={t('map.standard')}>
            <MapIcon aria-hidden />
            <span className="hidden sm:inline">{t('map.standard')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="satellite" className="h-10 gap-1 px-2.5 text-sm" aria-label={t('map.satellite')}>
            <Satellite aria-hidden />
            <span className="hidden sm:inline">{t('map.satellite')}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="hidden flex-col overflow-hidden rounded-lg border bg-card shadow-sm sm:flex" role="group" aria-label={t('map.zoom')}>
          <button type="button" className={control} onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')}>
            <Plus className="size-5" aria-hidden />
          </button>
          <span className="h-px bg-border" aria-hidden />
          <button type="button" className={control} onClick={() => map.current?.zoomOut()} aria-label={t('map.zoomOut')}>
            <Minus className="size-5" aria-hidden />
          </button>
        </div>
        <button type="button" className={`${control} rounded-lg border bg-card shadow-sm`} onClick={locate} disabled={locating} aria-label={t('map.locate')}>
          {locating ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <LocateFixed className="size-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
