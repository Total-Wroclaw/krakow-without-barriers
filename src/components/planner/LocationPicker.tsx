'use client';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { LoaderCircle, LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { CityPlace } from '@/lib/city-types';
import { useI18n } from '@/lib/i18n/client';
import { PlaceInput } from './PlaceInput';
import { gpsPoint, inKrakow } from './Reports';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

type Preset = { key: string; label: string; place: CityPlace | (() => Promise<CityPlace | null>) };

/**
 * Confirm or correct where a report belongs: the map moves under a fixed centre pin, the nearest
 * address is shown, and presets (my location, selected place, map centre) jump the map there.
 * An address search reaches any point without dragging the map (WCAG 2.5.7, 2.1.1).
 * The chosen point is always visible as text before anything is sent.
 */
export function LocationPicker({ value, onChange, presets }: { value: CityPlace; onChange: (p: CityPlace) => void; presets: Preset[] }) {
  const { t, locale } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [label, setLabel] = useState(value.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [searched, setSearched] = useState<CityPlace | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [value.lon, value.lat],
      zoom: 17,
      attributionControl: { compact: true },
      // One-finger page scroll keeps working on phones; two fingers move the map.
      cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
      locale: { 'Map.Title': t('report.pickerMap'), 'AttributionControl.ToggleAttribution': t('map.attribution'), 'CooperativeGesturesHandler.MobileHelpText': t('map.twoFingers') },
    });
    instance.on('moveend', async e => {
      // Only user moves and preset jumps (not the initial render) change the chosen point.
      if (!(e as { originalEvent?: unknown }).originalEvent && !(e as { preset?: boolean }).preset) return;
      const c = instance.getCenter();
      const point = { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) };
      if (!inKrakow(point)) return;
      // Moved away from a searched address: the field no longer describes the point.
      if (!(e as { preset?: boolean }).preset) setSearched(null);
      const name = (await reverseName(point, locale)) ?? t('report.mapPoint');
      setLabel(name);
      latest.current({ id: `point:${point.lat}:${point.lon}`, name, lat: point.lat, lon: point.lon, source: 'map' });
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
    // The map is created once; later value changes come from presets via jumpTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setLabel(value.name), [value.name]);

  async function usePreset(preset: Preset) {
    setBusy(preset.key);
    const place = typeof preset.place === 'function' ? await preset.place() : preset.place;
    setBusy(null);
    if (!place) return;
    map.current?.jumpTo({ center: [place.lon, place.lat], zoom: Math.max(map.current.getZoom(), 17) }, { preset: true });
    setLabel(place.name);
    latest.current(place);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <Button key={p.key} type="button" variant="outline" className="h-10" onClick={() => usePreset(p)} disabled={busy !== null}>
            {busy === p.key ? <LoaderCircle className="animate-spin" /> : p.key === 'gps' ? <LocateFixed /> : <MapPin />}
            {p.label}
          </Button>
        ))}
      </div>
      <div className="rounded-xl border bg-card">
        <PlaceInput
          label={t('report.whereSearch')}
          placeholder={t('report.whereSearchPlaceholder')}
          value={searched}
          onChange={p => {
            if (!p) return setSearched(null);
            setSearched(p);
            usePreset({ key: 'search', label: p.name, place: p });
          }}
          marker="end"
          near={value}
          onError={m => toast.error(m)}
        />
      </div>
      <div className="relative h-56 overflow-hidden rounded-xl border">
        <div ref={container} className="size-full" />
        {/* The point is the tip of this pin at the centre of the map. */}
        <MapPin aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-full fill-primary text-white drop-shadow" strokeWidth={1.5} />
        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
          <button type="button" className="grid size-11 place-items-center hover:bg-accent" onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')}>
            <Plus className="size-5" aria-hidden />
          </button>
          <span className="h-px bg-border" aria-hidden />
          <button type="button" className="grid size-11 place-items-center hover:bg-accent" onClick={() => map.current?.zoomOut()} aria-label={t('map.zoomOut')}>
            <Minus className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <p className="text-sm" role="status" aria-live="polite">
        <span className="text-muted-foreground">{t('report.chosenPlace')}: </span>
        <span className="font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{t('report.moveMapHint')}</span>
      </p>
    </div>
  );
}

/** The nearest address or named place for a point, or null when there is none (or the request fails). */
export async function reverseName(point: { lat: number; lon: number }, locale: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/places?reverse=1&lat=${point.lat}&lon=${point.lon}&locale=${locale}`);
    const data = await res.json();
    if (res.ok && typeof data.place?.name === 'string' && data.place.name) return data.place.name;
  } catch {}
  return null;
}

/** GPS preset, resolved to the nearest address. */
export async function gpsPlace(fallbackName: string, locale: string): Promise<CityPlace | null> {
  const gps = await gpsPoint();
  if (!gps || !inKrakow(gps)) return null;
  const name = (await reverseName(gps, locale)) ?? fallbackName;
  return { id: `point:${gps.lat}:${gps.lon}`, name, lat: gps.lat, lon: gps.lon, source: 'GPS' };
}
