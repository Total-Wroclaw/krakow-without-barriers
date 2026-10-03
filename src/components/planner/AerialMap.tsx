'use client';
// Pannable aerial map of a place: GUGiK orthophoto tiles (our cached proxy) as the only layer, mapped
// stairs/surfaces/benches/kerbs as map layers and the numbered pins, stairs, observations from the photo and the
// place itself as focusable buttons with a hover/tap card. The wheel over any part of it (pins and their cards
// included) zooms the map instead of scrolling the card; on touch screens one finger scrolls the page and two
// move the map. The view is fitted once; after that only the "back to frame" button moves it.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { LoaderCircle, Locate, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { DEFAULT_WIDTH, frameCorners } from '@/lib/aerial-geo';
import { nearestStairs, type AerialObservation, type AerialOverlay } from '@/lib/aerial-types';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { ObservationBadge, PinBadge, PlaceBadge, PointCard, StairsBadge, usePointLabel, type MapPoint, type Point } from './AerialParts';
import styles from './AerialSection.module.css';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const orthoTiles = () => `${window.location.origin}/api/tiles/ortho/{z}/{x}/{y}`;
/** One beam pass over the photo while the AI reads it. */
const SCAN_MS = 3200;
type FeatureData = Exclude<Parameters<GeoJSONSource['setData']>[0], string>;
type Feature = Extract<FeatureData, { type: 'FeatureCollection' }>['features'][number];
const collection = (features: Feature[]): FeatureData => ({ type: 'FeatureCollection', features });

export type AerialPhase = 'points' | 'image' | 'ai' | 'done';

export function AerialMap({ place, name, overlay, widthM, observations, placeholder, phase, large = false, onEnlarge }: {
  place: Point;
  name: string;
  overlay: AerialOverlay | null;
  /** Width of the analysed frame (auto); null until the overlay is known. */
  widthM: number | null;
  observations: AerialObservation[];
  /** The analysed crop, shown until the tiles have rendered. */
  placeholder: string | null;
  phase: AerialPhase;
  large?: boolean;
  onEnlarge?: () => void;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  /** Set by any pointer, wheel or key interaction with the map; cleared by "back to frame". */
  const userMoved = useRef(false);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [tilesShown, setTilesShown] = useState(false);
  const [, setTick] = useState(0);
  const frame = useRef<number | null>(null);

  const fit = useCallback(
    (animate: boolean) => {
      const m = map.current;
      if (!m) return;
      const [sw, ne] = frameCorners(place, widthM ?? DEFAULT_WIDTH);
      m.fitBounds([[sw.lon, sw.lat], [ne.lon, ne.lat]], { padding: 0, animate, duration: animate ? 600 : 0 });
    },
    [place, widthM],
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    if (!container.current) return;
    const [sw, ne] = frameCorners(place, DEFAULT_WIDTH);
    // Phones and tablets: one finger keeps scrolling the card/drawer, two fingers move the photo. The enlarged
    // dialog has nothing to scroll, so it takes one finger.
    const touch = !large && window.matchMedia('(pointer: coarse)').matches;
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: { ortho: { type: 'raster', tiles: [orthoTiles()], tileSize: 256, minzoom: 8, maxzoom: 19 } },
        layers: [{ id: 'ortho', type: 'raster', source: 'ortho', paint: { 'raster-fade-duration': 120 } }],
      },
      bounds: [[sw.lon, sw.lat], [ne.lon, ne.lat]],
      // Stay around the place: the card is about getting in, not about browsing the city.
      maxBounds: [[place.lon - 0.025, place.lat - 0.016], [place.lon + 0.025, place.lat + 0.016]],
      minZoom: 14,
      maxZoom: 20,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      cooperativeGestures: touch,
      locale: { 'CooperativeGesturesHandler.MobileHelpText': t('aerial.twoFingers') },
    });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    instance.getCanvas().setAttribute('aria-label', t('aerial.mapLabel'));
    instance.getCanvas().setAttribute('role', 'application');
    const redraw = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setTick(n => n + 1);
      });
    };
    instance.on('move', redraw);
    instance.on('resize', redraw);
    instance.on('movestart', e => {
      if ('originalEvent' in e && e.originalEvent) {
        userMoved.current = true;
        setTilesShown(true);
      }
    });
    let lastSize = { w: container.current.clientWidth, h: container.current.clientHeight };
    instance.on('idle', () => setTilesShown(true));
    instance.on('load', () => {
      instance.addSource('lines', { type: 'geojson', data: collection([]) });
      instance.addSource('markers', { type: 'geojson', data: collection([]) });
      instance.addLayer({ id: 'rough-casing', type: 'line', source: 'lines', filter: ['==', ['get', 'kind'], 'rough'], layout: { 'line-join': 'round' }, paint: { 'line-color': 'rgba(20,33,61,0.55)', 'line-width': 4 } });
      instance.addLayer({ id: 'rough', type: 'line', source: 'lines', filter: ['==', ['get', 'kind'], 'rough'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#fcd34d', 'line-width': 2, 'line-dasharray': [2.5, 2] } });
      instance.addLayer({ id: 'stairs-casing', type: 'line', source: 'lines', filter: ['==', ['get', 'kind'], 'stairs'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
      instance.addLayer({ id: 'stairs', type: 'line', source: 'lines', filter: ['==', ['get', 'kind'], 'stairs'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#a1460a', 'line-width': 4 } });
      instance.addLayer({ id: 'markers', type: 'circle', source: 'markers', paint: {
        'circle-radius': 4.5,
        'circle-color': ['match', ['get', 'kind'], 'bench', '#0f766e', '#a1460a'],
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
      } });
      setReady(true);
    });
    const observer = new ResizeObserver(([entry]) => {
      instance.resize();
      // Refit only for a real layout change (first layout, rotation) before the person has touched the map,
      // not for a scrollbar appearing when the text below grows.
      const size = { w: entry.contentRect.width, h: entry.contentRect.height };
      const changed = Math.abs(size.w - lastSize.w) > 40 || Math.abs(size.h - lastSize.h) > 40;
      lastSize = size;
      if (changed && !userMoved.current) fitRef.current(false);
    });
    observer.observe(container.current);
    map.current = instance;
    return () => {
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      instance.remove();
      map.current = null;
    };
    // The map is created once per place (the parent keys this component by place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fit: zoom to the auto frame once it is known, unless the person has already moved the map.
  // Never again on its own (new analysis, observations or overlay updates leave the view alone).
  useEffect(() => {
    if (!widthM || fitted.current) return;
    fitted.current = true;
    if (!userMoved.current) fit(true);
  }, [fit, widthM]);

  // Wheel anywhere over the map (pins, controls, attribution, point cards) zooms the map and never scrolls the
  // card behind. MapLibre handles plain wheel on its canvas itself; anything layered on top forwards a copy to
  // the canvas. In cooperative (touch) mode MapLibre would ask for Ctrl + wheel, but a mouse or trackpad on a
  // touch device should just zoom: the copy says Ctrl is held (MapLibre zooms the same way either way).
  const forwardWheel = useCallback((e: WheelEvent) => {
    const m = map.current;
    if (!m || !e.isTrusted) return;
    userMoved.current = true;
    const cooperative = m.cooperativeGestures.isEnabled();
    if (!cooperative && m.getCanvasContainer().contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    m.getCanvas().dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
        ctrlKey: cooperative || e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      }),
    );
  }, []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const touched = () => void (userMoved.current = true);
    // Capture: runs before MapLibre's own listener on the canvas container.
    el.addEventListener('wheel', forwardWheel, { passive: false, capture: true });
    el.addEventListener('pointerdown', touched);
    el.addEventListener('keydown', touched);
    return () => {
      el.removeEventListener('wheel', forwardWheel, { capture: true });
      el.removeEventListener('pointerdown', touched);
      el.removeEventListener('keydown', touched);
    };
  }, [forwardWheel]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !overlay) return;
    (m.getSource('lines') as GeoJSONSource).setData(collection(overlay.lines.map(l => ({ type: 'Feature', properties: { kind: l.kind }, geometry: { type: 'LineString', coordinates: l.points.map(([lat, lon]) => [lon, lat]) } }))));
    (m.getSource('markers') as GeoJSONSource).setData(collection(overlay.markers.map(mk => ({ type: 'Feature', properties: { kind: mk.kind }, geometry: { type: 'Point', coordinates: [mk.lon, mk.lat] } }))));
  }, [ready, overlay]);

  // Beam position for the scanning state, driven per frame so the pins it passes light up in sync.
  const scanning = phase !== 'done';
  const [leaving, setLeaving] = useState(false);
  const [showScan, setShowScan] = useState(scanning);
  useEffect(() => {
    if (scanning) {
      setShowScan(true);
      setLeaving(false);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let id = 0;
      const start = performance.now();
      const step = (now: number) => {
        root.current?.style.setProperty('--scan', String(((now - start) % SCAN_MS) / SCAN_MS));
        id = requestAnimationFrame(step);
      };
      id = requestAnimationFrame(step);
      return () => cancelAnimationFrame(id);
    }
    setLeaving(true);
    const timer = setTimeout(() => setShowScan(false), 750);
    return () => clearTimeout(timer);
  }, [scanning]);

  const points = useMemo<MapPoint[]>(() => {
    if (!overlay) return [{ key: 'place', type: 'place', ...place, name }];
    return [
      ...nearestStairs(overlay).map(({ line, mid }) => ({ key: `s-${line.id}`, type: 'stairs' as const, lat: mid.lat, lon: mid.lon, line })),
      ...observations.map(o => ({ key: `o-${o.id}`, type: 'observation' as const, lat: o.lat, lon: o.lon, observation: o })),
      ...overlay.pins.map(pin => ({ key: `p-${pin.n}`, type: 'pin' as const, lat: pin.lat, lon: pin.lon, pin })),
      // Last in the list and highest z-index: the place is always on top.
      { key: 'place', type: 'place' as const, ...place, name },
    ];
  }, [overlay, observations, place, name]);

  const m = map.current;
  const size = m ? { w: m.getContainer().clientWidth, h: m.getContainer().clientHeight } : null;
  const steps: { key: AerialPhase; label: string; done: boolean }[] = [
    { key: 'points', label: t('aerial.step.points'), done: !!overlay },
    { key: 'image', label: t('aerial.step.image'), done: tilesShown || phase === 'ai' || phase === 'done' },
    { key: 'ai', label: t('aerial.step.ai'), done: phase === 'done' },
  ];
  const current = steps.find(s => !s.done);

  return (
    <div ref={root} className={cn('relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted', styles.map)} style={{ ['--scan' as string]: 0 }} data-vaul-no-drag>
      {placeholder && !tilesShown ? (
        // eslint-disable-next-line @next/next/no-img-element -- decorative placeholder; the map has its own label
        <img src={placeholder} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      {!placeholder && !tilesShown ? <div className="absolute inset-0 bg-muted motion-safe:animate-pulse" aria-hidden /> : null}
      {/* MapLibre makes its container position: relative, so it sits inside a positioned wrapper. */}
      <div className="absolute inset-0">
        <div ref={container} className="size-full" />
      </div>

      {showScan ? (
        <div className={cn(styles.scan, 'z-[5]', leaving && styles.leaving)} aria-hidden>
          <div className={styles.grid} />
          <div className={styles.trail} />
          <div className={styles.beam} />
        </div>
      ) : null}

      {m && size && ready ? (
        <div className="pointer-events-none absolute inset-0 z-10">
          {placed(points, p => m.project([p.lon, p.lat]), size).map(({ point: p, x, y }) => (
            <MapButton key={p.key} point={p} overlay={overlay} x={x} y={y} z={p.type === 'place' ? 50 : p.type === 'pin' ? 30 : p.type === 'observation' ? 20 : 10} lit={showScan && !leaving ? y / size.h : null} large={large} onWheel={forwardWheel} />
          ))}
        </div>
      ) : null}

      {/* One quiet pill for the current step; the same progress is announced by the status line below the map. */}
      {showScan && current ? (
        <p aria-hidden className={cn('absolute left-2 top-2 z-20 flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-full bg-card/90 px-2.5 py-1 text-xs font-medium text-foreground shadow transition-opacity duration-700', leaving && 'opacity-0')}>
          <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden />
          <span className="truncate">{current.label}</span>
        </p>
      ) : null}

      <div className="absolute right-2 top-2 z-20 flex flex-col gap-1.5">
        <Control label={t('aerial.closer')} onClick={() => map.current?.zoomIn()}>
          <ZoomIn />
        </Control>
        <Control label={t('aerial.wider')} onClick={() => map.current?.zoomOut()}>
          <ZoomOut />
        </Control>
        <Control
          label={t('aerial.reset')}
          onClick={() => {
            userMoved.current = false;
            fit(true);
          }}
        >
          <Locate />
        </Control>
        {onEnlarge ? (
          <Control label={t('aerial.enlarge')} onClick={onEnlarge}>
            <Maximize2 />
          </Control>
        ) : null}
      </div>
      <p className="pointer-events-none absolute bottom-1 left-1 z-20 rounded bg-card/85 px-1.5 py-px text-[10px] font-medium text-foreground">© GUGiK</p>
    </div>
  );
}

/**
 * Points to draw at their screen positions. The place and numbered pins always show; stairs and AI markers that
 * would sit on top of another target are left out at this zoom (zooming in reveals them; the text list has all).
 */
function placed(points: MapPoint[], toScreen: (p: MapPoint) => { x: number; y: number }, size: { w: number; h: number }) {
  const MIN_GAP = 26;
  const priority = (p: MapPoint) => (p.type === 'place' ? 0 : p.type === 'pin' ? 1 : p.type === 'observation' ? 2 : 3);
  const kept: { point: MapPoint; x: number; y: number }[] = [];
  for (const point of [...points].sort((a, b) => priority(a) - priority(b))) {
    const { x, y } = toScreen(point);
    if (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20) continue;
    if (priority(point) >= 2 && kept.some(k => Math.hypot(k.x - x, k.y - y) < MIN_GAP)) continue;
    kept.push({ point, x, y });
  }
  // Render order = stacking order: the place last, on top of everything.
  return kept.reverse();
}

function Control({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full border bg-card/95 text-foreground shadow-md outline-none transition hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

function MapButton({ point, overlay, x, y, z, lit, large, onWheel }: { point: MapPoint; overlay: AerialOverlay | null; x: number; y: number; z: number; lit: number | null; large: boolean; onWheel: (e: WheelEvent) => void }) {
  const label = usePointLabel()(point);
  const [open, setOpen] = useState<null | 'hover' | 'click'>(null);
  // Closing after a short delay lets the pointer move from the pin into its card.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (via: 'hover' | 'click') => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(via);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(o => (o === 'hover' ? null : o)), 150);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // The card is portalled out of the map: the wheel over it zooms the map too (React's onWheel is passive).
  const cardRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    },
    [onWheel],
  );
  const badge =
    point.type === 'place' ? <PlaceBadge large={large} />
    : point.type === 'pin' ? <PinBadge pin={point.pin} large={large} />
    : point.type === 'stairs' ? <StairsBadge large={large} />
    : <ObservationBadge id={point.observation.id} large={large} />;
  const card = <PointCard point={point} overlay={overlay ?? { place: { lat: point.lat, lon: point.lon }, pins: [], markers: [], lines: [], osmObtainedAt: null, transitObtainedAt: null }} />;

  return (
    <Popover open={!!open} onOpenChange={o => !o && setOpen(null)}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={!!open}
          aria-haspopup="dialog"
          onClick={() => setOpen(o => (o === 'click' ? null : 'click'))}
          onPointerEnter={e => e.pointerType === 'mouse' && show('hover')}
          onPointerLeave={e => e.pointerType === 'mouse' && hide()}
          onFocus={e => e.currentTarget.matches(':focus-visible') && show('hover')}
          onBlur={hide}
          style={{ left: x, top: y, zIndex: z, ...(lit !== null ? { ['--y' as string]: lit } : {}) }}
          className={cn(
            'pointer-events-auto absolute grid min-h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-1',
            lit !== null && styles.lit,
          )}
        >
          {badge}
        </button>
      </PopoverAnchor>
      <PopoverContent
        ref={cardRef}
        side="top"
        sideOffset={10}
        collisionPadding={8}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        // Escape closes the card only, not the place card or dialog around the map.
        onEscapeKeyDown={e => e.stopPropagation()}
        onPointerEnter={() => open === 'hover' && show('hover')}
        onPointerLeave={() => open === 'hover' && hide()}
        className="w-64 p-3 text-sm"
      >
        {card}
      </PopoverContent>
    </Popover>
  );
}
