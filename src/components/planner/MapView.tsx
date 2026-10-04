'use client';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
import { Flag, LoaderCircle, LocateFixed, Map as MapIcon, Minus, Plus, Satellite, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CityFact, CityPlace } from '@/lib/city-types';
import type { MapViewport, PlaceObjectSummary } from '@/lib/explore-types';
import { useI18n } from '@/lib/i18n/client';
import type { JourneyOption } from '@/lib/journey-types';
import type { Report } from '@/lib/schemas';
import { allFacts, factTitle } from '@/lib/journey-ui';
import { stairsPaths } from './icons';
import { reverseName } from './LocationPicker';
import { inKrakow, useReportTitle } from './Reports';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const STYLE = 'https://tiles.openfreemap.org/styles/positron';
// Official Polish orthophoto (GUGiK), free reuse with attribution, served through our disk-cached tile proxy.
const orthoTiles = () => `${window.location.origin}/api/tiles/ortho/{z}/{x}/{y}`;
const KRAKOW: [number, number] = [19.945, 50.061];
/** Passed as event data on camera moves the app makes itself, so they are not mistaken for the user exploring. */
const APP_MOVE = { krokApp: true };
const colors = { walk: '#14213d', tram: '#c4122f', bus: '#2443b0', drive: '#0e6c80' };

const icons = {
  down: stairsPaths.down,
  up: stairsPaths.up,
  unknown: stairsPaths.any,
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

/**
 * Hides route markers that would sit on top of one already shown, so every visible marker keeps its own
 * 24 px target (WCAG 2.5.8) and stays readable. Markers are listed most important first; hidden ones are
 * still in the route's step list, which is the text alternative to the map.
 */
function declutter(instance: MapLibreMap, list: { el: HTMLElement; lat: number; lon: number }[], hideMinor: boolean) {
  const shown: { x: number; y: number; r: number }[] = [];
  for (const m of list) {
    if (hideMinor && m.el.classList.contains('map-minor')) continue;
    const { x, y } = instance.project([m.lon, m.lat]);
    const r = m.el.offsetWidth / 2 || 15;
    const clash = shown.some(o => Math.hypot(o.x - x, o.y - y) < o.r + r + 2);
    m.el.style.visibility = clash ? 'hidden' : '';
    if (clash) m.el.setAttribute('tabindex', '-1');
    else if (m.el.getAttribute('tabindex') === '-1' && m.el.dataset.focusable !== 'false') m.el.removeAttribute('tabindex');
    if (!clash) shown.push({ x, y, r });
  }
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

export type PickRole = 'from' | 'to';

type Props = {
  options: JourneyOption[];
  selectedId: string | null;
  /** Route details are open: the other routes are only drawn faded underneath, and map clicks never switch routes. */
  detail?: boolean;
  /** A point opened from a list (e.g. a barrier in the steps); the map pans to it only if it is off-screen. */
  focus?: { lat: number; lon: number } | null;
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
  /** After every camera move: the visible area (`user` false for the app's own fits). */
  onViewportChange?: (viewport: MapViewport) => void;
  /** Places are fitted into view only when this changes (an explicit new search), not on every new result set. */
  objectsFitKey?: string | number;
  /** Set when a click on empty map may offer "set as start / destination" (the Route tab). */
  onPick?: (role: PickRole, place: CityPlace) => void;
  pickRoles?: PickRole[];
  /** Pixels of the map covered from below (the phone's panel sheet): fits, pans and the visible area leave it out. */
  bottomInset?: number;
};

type Pick = { lat: number; lon: number; name?: string | null };

const coords = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
const flat = (p: { lat: number; lon: number } | null | undefined) => (p ? `${p.lat},${p.lon}` : '');

export default function MapView({ options, selectedId, detail = false, focus, from, to, reports, objects = [], selectedObjectId, onSelect, onFact, onReport, onObject, onMove, onViewportChange, objectsFitKey, onPick, pickRoles = ['from', 'to'], bottomInset = 0 }: Props) {
  const { t, tp, locale } = useI18n();
  const reportTitle = useReportTitle();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const markers = useRef<Marker[]>([]);
  const [base, setBase] = useState<'standard' | 'satellite'>('standard');
  const latest = useRef({ onSelect, onFact, onReport, onObject, onMove, onPick, detail, onViewportChange });
  latest.current = { onSelect, onFact, onReport, onObject, onMove, onPick, detail, onViewportChange };
  const render = useRef<() => void>(() => {});
  /** Re-runs marker decluttering for the current zoom. */
  const routeMarkers = useRef<() => void>(() => {});
  // Read when the camera moves, so dragging the sheet never re-renders or moves the map.
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const reportViewport = useRef<(user: boolean) => void>(() => {});
  // Raising or lowering the phone sheet changes what is visible without moving the map: report the new area
  // once the sheet settles (as the person's own change, so lists follow it without refitting the map).
  useEffect(() => {
    if (!map.current) return;
    const timer = window.setTimeout(() => reportViewport.current(true), 350);
    return () => window.clearTimeout(timer);
  }, [bottomInset]);
  /** Shifts a camera target up into the part of the map that is not covered. */
  const lift = () => ({ offset: [0, -inset.current / 2] as [number, number] });
  /** What the camera last reacted to; see the camera rules in `render`. */
  const seen = useRef({ results: [] as JourneyOption[], detail: '', ends: '', objects: '', object: '', focus: '' });
  /** A place picked on the map itself is already in view, so choosing it must not move the camera. */
  const clickedObject = useRef<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const pickRef = useRef<Pick | null>(null);
  pickRef.current = pick;
  const pickPin = useRef<Marker | null>(null);
  const pickName = useRef<Promise<string | null> | null>(null);
  const pickHeading = useId();
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
        map.current?.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.current.getZoom(), 16), duration: 600, ...lift() });
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
    const minor = () => {
      container.current?.classList.toggle('hide-minor', instance.getZoom() < 15);
      routeMarkers.current();
    };
    instance.on('zoomend', minor);
    instance.on('load', () => {
      minor();
      // Satellite sits under the labels of the base style so street names stay readable.
      const firstSymbol = instance.getStyle().layers.find(l => l.type === 'symbol')?.id;
      instance.addSource('ortho', { type: 'raster', tiles: [orthoTiles()], tileSize: 256, minzoom: 8, maxzoom: 19, attribution: '© <a href="https://www.geoportal.gov.pl">GUGiK</a>' });
      instance.addLayer({ id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: 'none' } }, firstSymbol);
      instance.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // In details the alternatives stay visible for context, but faded, thin and on their own layer: never hit-tested, no pointer cursor.
      instance.addLayer({ id: 'routes-faded', type: 'line', source: 'routes', filter: ['==', ['get', 'faded'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7d879c', 'line-width': 3, 'line-opacity': 0.35 } });
      instance.addLayer({ id: 'routes-other', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'selected'], false], ['==', ['get', 'faded'], false]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7d879c', 'line-width': 5, 'line-opacity': 0.6 } });
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
      instance.on('mouseenter', 'objects', () => (instance.getCanvas().style.cursor = 'pointer'));
      instance.on('mouseleave', 'objects', () => (instance.getCanvas().style.cursor = ''));
      instance.on('mouseenter', 'routes-other', () => (instance.getCanvas().style.cursor = 'pointer'));
      instance.on('mouseleave', 'routes-other', () => (instance.getCanvas().style.cursor = ''));
      // One click handler decides what a click means, in this order:
      // markers (barriers, reports, ends) > places > the chosen route > alternatives > empty map.
      // Per-layer handlers would fire for every line under the pointer, so a tap on the chosen
      // route used to switch to an alternative lying underneath it.
      let pickTimer: number | undefined;
      instance.on('click', (e: MapMouseEvent) => {
        window.clearTimeout(pickTimer);
        // HTML markers handle their own clicks; nothing below them may react as well.
        if ((e.originalEvent.target as Element | null)?.closest?.('.maplibregl-marker')) return;
        const r = window.matchMedia('(pointer: coarse)').matches ? 12 : 6;
        const box: [[number, number], [number, number]] = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
        const hit = (layers: string[]) => instance.queryRenderedFeatures(box, { layers });
        const object = hit(['objects'])[0]?.properties?.id;
        if (typeof object === 'string') {
          clickedObject.current = object;
          setPick(null);
          latest.current.onObject?.(object);
          return;
        }
        if (hit(['routes-casing', 'routes-vehicle', 'routes-walk']).length) return;
        const other = hit(['routes-other'])[0]?.properties?.option;
        if (typeof other === 'string') {
          // Alternatives are only clickable in the list of options (in details they are on 'routes-faded', never queried).
          if (!latest.current.detail) {
            setPick(null);
            latest.current.onSelect(other);
          }
          return;
        }
        if (!latest.current.onPick) return;
        // Wait out a double-click or double-tap, which zooms instead.
        const { lat, lng } = e.lngLat;
        pickTimer = window.setTimeout(() => setPick({ lat: +lat.toFixed(6), lon: +lng.toFixed(6) }), 260);
      });
      instance.on('dblclick', () => window.clearTimeout(pickTimer));
      ready.current = true;
      render.current();
    });
    const viewport = (user: boolean): MapViewport => {
      // Only the uncovered part of the map counts as visible (north-up map, so two corners are enough).
      const { clientWidth: w, clientHeight: h } = instance.getContainer();
      const bottom = Math.max(1, h - inset.current);
      const nw = instance.unproject([0, 0]);
      const se = instance.unproject([w, bottom]);
      const c = instance.unproject([w / 2, bottom / 2]);
      return { bbox: [nw.lng, se.lat, se.lng, nw.lat], center: { lat: c.lat, lon: c.lng }, zoom: instance.getZoom(), user };
    };
    reportViewport.current = user => latest.current.onViewportChange?.(viewport(user));
    instance.once('load', () => latest.current.onViewportChange?.(viewport(false)));
    instance.on('moveend', e => {
      const c = instance.getCenter();
      latest.current.onMove?.({ lat: c.lat, lon: c.lng });
      latest.current.onViewportChange?.(viewport(!(e as { krokApp?: boolean }).krokApp));
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
      // In route details the other routes are drawn faded for context, on a layer that cannot be tapped.
      const features = options.flatMap(option =>
        option.legs.map(leg => ({
          type: 'Feature' as const,
          properties: { option: option.id, selected: option.id === selectedId, faded: detail && option.id !== selectedId, kind: leg.type === 'walk' ? 'walk' : leg.type === 'drive' ? 'drive' : leg.mode },
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
      const placed: { el: HTMLElement; lat: number; lon: number; rank: number }[] = [];
      if (selected) {
        for (const fact of allFacts(selected)) {
          const icon = fact.kind === 'toilet' ? icons.toilet : fact.kind === 'bench' ? icons.bench : fact.kind === 'entrance' ? icons.entrance : fact.kind === 'kerb' ? icons.kerb : fact.kind === 'surface' ? icons.surface : icons[fact.direction];
          const bg = fact.kind === 'toilet' ? '#7a3e9d' : fact.kind === 'bench' ? '#0f766e' : fact.kind === 'entrance' ? '#2443b0' : '#a1460a';
          const el = markerElement(factTitle(fact, t, tp), icon, bg, fact.kind === 'stairs' ? 34 : 30);
          // Stairs always show; benches and entrances only once zoomed in, to avoid clutter.
          if (fact.kind !== 'stairs' && fact.kind !== 'kerb' && fact.kind !== 'toilet' && !fact.restAfterMinutes) el.classList.add('map-minor');
          el.addEventListener('click', () => latest.current.onFact(fact));
          add(el, fact.lat, fact.lon);
          // Barriers first, then planned rests and toilets, then the rest.
          const rank = fact.kind === 'stairs' || fact.kind === 'kerb' ? 0 : fact.restAfterMinutes || fact.kind === 'toilet' ? 1 : 2;
          placed.push({ el, lat: fact.lat, lon: fact.lon, rank });
        }
        for (const leg of selected.legs) {
          if (leg.type !== 'drive' || !leg.parking) continue;
          const el = markerElement(t('option.parking', { name: leg.parking.name }), '<path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>', '#0e6c80', 30);
          el.tabIndex = -1;
          el.dataset.focusable = 'false';
          add(el, leg.parking.lat, leg.parking.lon);
          placed.push({ el, lat: leg.parking.lat, lon: leg.parking.lon, rank: 1 });
        }
      }
      placed.sort((a, b) => a.rank - b.rank);
      routeMarkers.current = () => declutter(instance, placed, instance.getZoom() < 15);
      routeMarkers.current();
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

      /*
       * Camera rules. The map only moves by itself when what it is about changes:
       *  1. route details open for the first time on a route → fit that route;
       *  2. new results arrive (another set of route options, or a new Explore search) → fit them all;
       *  3. a start/destination is chosen in search → show it (points picked on the map are already in view);
       *  4. a place is chosen in the Explore list → centre on it.
       * Never on: marker or line clicks, picking another option in the list, hover, more results
       * appended (paging), reports refreshing, base-map or language switches, re-renders.
       * A card opened from a list (e.g. a barrier in the steps) only pans, at the same zoom,
       * if its point is off-screen. The you-are-here dot never recentres; only the locate button does.
       */
      const prev = seen.current;
      const next = {
        // A new results array only comes with a new answer from the planner.
        results: options,
        detail: detail && selected ? selected.id : '',
        ends: `${flat(from)}|${flat(to)}`,
        objects: objectsFitKey !== undefined ? String(objectsFitKey) : (objects[0]?.id ?? ''),
        object: selectedObjectId ?? '',
        focus: flat(focus),
      };
      seen.current = next;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600;
      const fit = (points: [number, number][]) => {
        if (points.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          points.forEach(([lat, lon]) => bounds.extend([lon, lat]));
          instance.fitBounds(bounds, { padding: { top: 70, bottom: 50 + inset.current, left: 50, right: 70 }, maxZoom: 17, duration }, APP_MOVE);
        } else if (points.length === 1) instance.easeTo({ center: [points[0][1], points[0][0]], zoom: 15, duration, ...lift() }, APP_MOVE);
      };
      const ends = () => [from, to].filter((p): p is CityPlace => !!p).map(p => [p.lat, p.lon] as [number, number]);
      /** Pans (same zoom) only when the point is not comfortably inside the visible map. */
      const reveal = (lat: number, lon: number) => {
        const { x, y } = instance.project([lon, lat]);
        const { clientWidth: w, clientHeight: h } = instance.getContainer();
        if (x < 40 || y < 40 || x > w - 40 || y > h - inset.current - 40) instance.easeTo({ center: [lon, lat], duration, ...lift() }, APP_MOVE);
      };

      if (next.detail && next.detail !== prev.detail && selected) {
        fit([...selected.legs.flatMap(l => l.geometry), ...ends()]);
      } else if (options.length && next.results !== prev.results) {
        fit([...(detail && selected ? [selected] : options).flatMap(o => o.legs.flatMap(l => l.geometry)), ...ends()]);
      } else if (next.ends !== prev.ends && next.ends !== '|') {
        // A point picked on the map (source 'map') is where the person is already looking.
        const changed = [from, to].filter(p => p && !prev.ends.split('|').includes(flat(p)));
        if (changed.some(p => p?.source !== 'map')) fit(ends());
      } else if (next.objects && next.objects !== prev.objects && !selectedObjectId) {
        fit(objects.map(o => [o.lat, o.lon]));
      }
      if (next.object && next.object !== prev.object) {
        const chosen = objects.find(o => o.id === selectedObjectId);
        if (chosen && clickedObject.current !== chosen.id) instance.easeTo({ center: [chosen.lon, chosen.lat], zoom: Math.max(instance.getZoom(), 16), duration, ...lift() }, APP_MOVE);
      }
      clickedObject.current = null;
      if (next.focus && next.focus !== prev.focus && focus) reveal(focus.lat, focus.lon);
    };
    render.current();
  }, [options, selectedId, detail, focus, from, to, reports, objects, objectsFitKey, selectedObjectId, t, tp, reportTitle, base]);

  // The clicked point: a temporary pin while the card is open, and its nearest address.
  const pickKey = pick ? `${pick.lat},${pick.lon}` : '';
  useEffect(() => {
    const instance = map.current;
    const point = pickRef.current;
    if (!instance || !point) return;
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'width:20px;height:20px;border-radius:999px 999px 999px 0;transform:rotate(-45deg);background:#14213d;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);pointer-events:none';
    const pin = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2] }).setLngLat([point.lon, point.lat]).addTo(instance);
    pickPin.current = pin;
    let live = true;
    const name = inKrakow(point) ? reverseName(point, locale) : Promise.resolve(null);
    pickName.current = name;
    name.then(found => live && setPick(current => (current && current.lat === point.lat && current.lon === point.lon ? { ...current, name: found } : current)));
    return () => {
      live = false;
      pin.remove();
      pickPin.current = null;
    };
    // Re-run per clicked point (and language), not when the name arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, locale]);
  // Leaving the Route tab closes the card.
  useEffect(() => {
    if (!onPick) setPick(null);
  }, [onPick]);

  /** Anchors the card to the clicked point; read every frame so it follows the map. */
  // The last clicked point, so a closing card fades out where it was instead of jumping to the corner.
  const lastPick = useRef<Pick | null>(null);
  const pickAnchor = useRef({
    getBoundingClientRect: () => {
      const instance = map.current;
      const point = pickRef.current ?? lastPick.current;
      if (pickRef.current) lastPick.current = pickRef.current;
      if (!instance || !point) return new DOMRect(-1000, -1000, 0, 0);
      const rect = instance.getContainer().getBoundingClientRect();
      const { x, y } = instance.project([point.lon, point.lat]);
      // The top of the pin, so the card sits above it.
      return new DOMRect(rect.left + x, rect.top + y - 24, 0, 24);
    },
  });

  async function choosePick(role: PickRole) {
    const point = pickRef.current;
    if (!point) return;
    const name = point.name !== undefined ? point.name : await pickName.current;
    setPick(null);
    onPick?.(role, { id: `point:${point.lat}:${point.lon}`, name: name ?? coords(point), lat: point.lat, lon: point.lon, source: 'map' });
  }

  const pickInside = pick ? inKrakow(pick) : false;
  const control = 'grid size-11 place-items-center text-foreground transition-colors hover:bg-accent disabled:opacity-50';
  return (
    <div className="relative size-full" style={{ '--map-inset': `${bottomInset}px` } as CSSProperties}>
      <div ref={container} className="size-full" />
      <Popover open={!!pick} onOpenChange={open => !open && setPick(null)}>
        <PopoverAnchor virtualRef={pickAnchor} />
        <PopoverContent
          side="top"
          sideOffset={8}
          collisionPadding={8}
          updatePositionStrategy="always"
          aria-labelledby={pickHeading}
          className="w-[min(20rem,calc(100vw-1rem))] p-0"
          onOpenAutoFocus={e => {
            e.preventDefault();
            const card = e.currentTarget as HTMLElement | null;
            (card?.querySelector<HTMLElement>('[data-pick-first]') ?? card?.querySelector<HTMLElement>('button'))?.focus();
          }}
          onCloseAutoFocus={e => {
            e.preventDefault();
            // Back to the map, unless the person has already moved on to something else.
            const active = document.activeElement;
            if (!active || active === document.body) map.current?.getCanvas().focus({ preventScroll: true });
          }}
        >
          <div className="flex items-start gap-1 py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1 py-2">
              <p className="text-xs text-muted-foreground">{t('map.point')}</p>
              <h2 id={pickHeading} className="break-words text-sm font-semibold leading-snug" aria-live="polite">
                {!pick ? null : pick.name === undefined ? (
                  <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    {t('map.pointLoading')}
                  </span>
                ) : (
                  (pick.name ?? coords(pick))
                )}
              </h2>
            </div>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" onClick={() => setPick(null)} aria-label={t('common.close')}>
              <X />
            </Button>
          </div>
          {pickInside ? (
            <div className="flex flex-wrap gap-2 border-t p-2">
              {pickRoles.includes('from') ? (
                <Button variant="outline" className="h-11 flex-1" onClick={() => choosePick('from')} data-pick-first>
                  <span aria-hidden className="size-3 shrink-0 rounded-full border-[3px] border-foreground bg-card" />
                  {t('map.setStart')}
                </Button>
              ) : null}
              {pickRoles.includes('to') ? (
                <Button className="h-11 flex-1" onClick={() => choosePick('to')} data-pick-first={pickRoles.includes('from') ? undefined : true}>
                  <Flag aria-hidden />
                  {t('map.setGoal')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="border-t px-3 py-2.5 text-sm text-muted-foreground">{t('map.pointOutside')}</p>
          )}
        </PopoverContent>
      </Popover>
      {/* A single row fits the exposed map above a phone sheet, including landscape. */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-start gap-2 lg:flex-col lg:items-end">
        <ToggleGroup
          type="single"
          value={base}
          onValueChange={v => v && setBase(v as 'standard' | 'satellite')}
          aria-label={t('map.style')}
          className="rounded-lg border bg-card p-0.5 shadow-sm"
        >
          <ToggleGroupItem value="standard" className="h-10 min-w-10 gap-1 px-2.5 text-sm" aria-label={t('map.standard')}>
            <MapIcon aria-hidden />
            <span className="hidden sm:inline">{t('map.standard')}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="satellite" className="h-10 min-w-10 gap-1 px-2.5 text-sm" aria-label={t('map.satellite')}>
            <Satellite aria-hidden />
            <span className="hidden sm:inline">{t('map.satellite')}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm sm:flex lg:flex-col" role="group" aria-label={t('map.zoom')}>
          <button type="button" className={control} onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')}>
            <Plus className="size-5" aria-hidden />
          </button>
          <span className="w-px bg-border lg:h-px lg:w-auto" aria-hidden />
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
