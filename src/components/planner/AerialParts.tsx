'use client';
// Pieces shared by the aerial map and its text equivalent: badges, fact wording and the point card.
import { ExternalLink, MapPin, Sparkles } from 'lucide-react';
import { compass, distance } from '@/lib/aerial-geo';
import { lineMiddle, type AerialLine, type AerialObservation, type AerialOverlay, type AerialPin } from '@/lib/aerial-types';
import { distance as formatDistance, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

export type Point = { lat: number; lon: number };

export function pinStyle(pin: AerialPin) {
  switch (pin.kind) {
    case 'entrance':
      return cn('rounded-md', pin.wheelchair === 'yes' || pin.wheelchair === 'limited' ? 'bg-rest' : pin.wheelchair === 'no' ? 'bg-barrier' : 'bg-ink');
    case 'stop':
      return cn('rounded-full', pin.modes?.includes('tram') ? 'bg-tram' : 'bg-bus');
    case 'parking':
      return 'rounded-md bg-drive';
    case 'toilet':
      return 'rounded-full bg-object';
  }
}

export function PinBadge({ pin, large = false, inline = false }: { pin: AerialPin; large?: boolean; inline?: boolean }) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center font-bold leading-none text-white tabular-nums ring-2 ring-white',
        inline ? 'mx-0.5 size-5 align-[-0.3em] text-[11px] shadow-none' : large ? 'size-7 text-sm shadow-md' : 'size-6 text-xs shadow-md',
        pinStyle(pin),
      )}
    >
      {pin.n}
    </span>
  );
}

export function ObservationBadge({ id, large = false, inline = false }: { id: string; large?: boolean; inline?: boolean }) {
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', inline ? 'mx-0.5 size-5 align-[-0.3em]' : large ? 'size-7' : 'size-6')}>
      <span className="absolute inset-[3px] rotate-45 rounded-[3px] bg-report shadow-md ring-2 ring-white" />
      <span className={cn('relative font-bold leading-none text-white', inline ? 'text-[10px]' : 'text-xs')}>{id}</span>
    </span>
  );
}

/** Stairs marker: amber square with a step glyph. */
export function StairsBadge({ large = false, inline = false }: { large?: boolean; inline?: boolean }) {
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-[5px] bg-barrier text-white ring-2 ring-white', inline ? 'mx-0.5 size-5 align-[-0.3em]' : large ? 'size-6 shadow-md' : 'size-5 shadow-md')}>
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20h5v-5h5v-5h6" />
      </svg>
    </span>
  );
}

/** The place itself: larger, crest red, always drawn on top. */
export function PlaceBadge({ large = false }: { large?: boolean }) {
  return (
    <span className={cn('relative grid place-items-center rounded-full border-[3px] border-white bg-tram text-white shadow-lg', large ? 'size-10' : 'size-9')}>
      <MapPin className={large ? 'size-5' : 'size-[18px]'} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

/** Wording of the sourced facts for pins and stairs, shared by cards and lists. */
export function useDescribe() {
  const { t, tp, locale } = useI18n();
  const where = (p: { distance: number; compass: string }) => t('aerial.distance', { distance: formatDistance(p.distance, locale), dir: t(`aerial.dir.${p.compass}` as MessageKey) });
  const details = (pin: AerialPin) => {
    const parts: string[] = [];
    if (pin.kind === 'entrance') {
      if (pin.main) parts.push(t('aerial.main'));
      parts.push(t(`aerial.wheelchair.${pin.wheelchair ?? 'unknown'}`));
      if (pin.steps !== undefined) parts.push(pin.steps === 0 ? t('aerial.noSteps') : tp('aerial.steps', pin.steps));
      if (pin.ramp) parts.push(t('aerial.ramp'));
      if (pin.doorWidth) parts.push(t('aerial.door', { cm: pin.doorWidth }));
      if (pin.automaticDoor) parts.push(t('aerial.autoDoor'));
    }
    if (pin.kind === 'stop') {
      if (pin.modes?.length) parts.push(pin.modes.map(m => t(`aerial.${m}`)).join(', '));
      if (pin.platform) parts.push(t('aerial.platform', { code: pin.platform }));
      if (pin.lines?.length) parts.push(t('aerial.lines', { list: pin.lines.join(', ') }));
    }
    if (pin.kind === 'parking') {
      if (pin.disabledSpaces) parts.push(tp('aerial.spaces', pin.disabledSpaces));
      parts.push(t(`aerial.fee.${pin.fee ?? 'unknown'}`));
      if (pin.capacity) parts.push(t('aerial.capacity', { n: pin.capacity }));
    }
    if (pin.kind === 'toilet' && pin.wheelchair === 'limited') parts.push(t('aerial.wheelchair.limited'));
    return parts;
  };
  const stairs = (line: AerialLine) => [
    line.steps !== undefined ? tp('aerial.steps', line.steps) : t('aerial.stepsUnknown'),
    t(`aerial.handrail.${line.handrail ?? 'unknown'}`),
    ...(line.ramp ? [t('aerial.ramp')] : []),
    t('aerial.direction'),
  ];
  const source = (kind: AerialPin['kind'] | 'stairs', editedAt: string | null, overlay: AerialOverlay) =>
    kind === 'stop'
      ? t('aerial.source.ztp', { date: formatDate(overlay.transitObtainedAt, locale, t('common.unknownDate')) })
      : t('aerial.source.osm', { date: formatDate(editedAt, locale, t('common.unknownDate')) });
  return { where, details, stairs, source };
}

export type MapPoint =
  | { key: string; type: 'place'; lat: number; lon: number; name: string }
  | { key: string; type: 'pin'; lat: number; lon: number; pin: AerialPin }
  | { key: string; type: 'stairs'; lat: number; lon: number; line: AerialLine }
  | { key: string; type: 'observation'; lat: number; lon: number; observation: AerialObservation };

/** Accessible name of a point on the map (also announced when it gets focus). */
export function usePointLabel() {
  const { t } = useI18n();
  return (p: MapPoint) =>
    p.type === 'place' ? `${t('aerial.place')}: ${p.name}`
    : p.type === 'pin' ? `${t('aerial.pin', { n: p.pin.n })}: ${t(`aerial.kind.${p.pin.kind}`)}${p.pin.name ? ` ${p.pin.name}` : ''}`
    : p.type === 'stairs' ? t('aerial.stairs')
    : `${t('aerial.observation', { id: p.observation.id })}: ${p.observation.label}`;
}

/** Content of the hover/tap card for a point: what it is, sourced facts, distance, source and date. */
export function PointCard({ point, overlay }: { point: MapPoint; overlay: AerialOverlay }) {
  const { t, locale } = useI18n();
  const { where, details, stairs, source } = useDescribe();
  const place = overlay.place;
  const away = (p: Point) => where({ distance: Math.round(distance(place, p)), compass: compass(place, p) });
  if (point.type === 'place') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-tram">{t('aerial.place')}</p>
        <p className="font-semibold leading-snug">{point.name}</p>
      </div>
    );
  }
  if (point.type === 'observation') {
    const o = point.observation;
    return (
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1 text-xs font-semibold text-report">
          <Sparkles className="size-3.5" aria-hidden />
          {t('aerial.aiUnverified')}
        </p>
        <p className="font-semibold leading-snug">{o.label}</p>
        <p className="text-muted-foreground">{t(`aerial.obs.${o.kind}`)} · {away(o)}</p>
      </div>
    );
  }
  const [title, facts, url, src] =
    point.type === 'pin'
      ? [`${t(`aerial.kind.${point.pin.kind}`)}${point.pin.name ? `: ${point.pin.name}` : ''}`, details(point.pin), point.pin.sourceUrl, source(point.pin.kind, point.pin.editedAt, overlay)]
      : [t('aerial.stairs'), stairs(point.line), `https://www.openstreetmap.org/${point.line.id.replace(':', '/')}`, source('stairs', point.line.editedAt, overlay)];
  const distanceText = point.type === 'pin' ? where(point.pin) : away(lineMiddle(point.line, place));
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-2 font-semibold leading-snug">
        {point.type === 'pin' ? <PinBadge pin={point.pin} inline /> : <StairsBadge inline />}
        {title}
      </p>
      {facts.length ? (
        <ul className="flex flex-col gap-0.5">
          {facts.map(f => <li key={f}>{f}</li>)}
        </ul>
      ) : null}
      <p className="text-muted-foreground">{t('aerial.fromPlace', { distance: distanceText })}</p>
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary underline underline-offset-2">
        {src}
        <ExternalLink className="size-3" aria-hidden />
        <span className="sr-only">{t('fact.newTab')}</span>
      </a>
    </div>
  );
}
