'use client';
// Pieces shared by the aerial map and its text equivalent: badges, fact wording and the point card.
import { useState, type ReactNode } from 'react';
import { Accessibility, BusFront, ChevronDown, CircleHelp, Coins, DoorOpen, ExternalLink, Footprints, Grip, MapPin, Navigation2, SquareParking, TramFront, type LucideIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

/**
 * Inline badges sit in running text: 18 px (fits the 20–23 px line boxes of text-sm without pushing lines apart),
 * no ring or shadow, centred on the x-height of the surrounding text whatever its size.
 */
const inlineBadge = 'mx-0.5 size-[18px] align-middle -translate-y-px';

export function PinBadge({ pin, large = false, inline = false }: { pin: AerialPin; large?: boolean; inline?: boolean }) {
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center font-bold leading-none text-white tabular-nums',
        inline ? cn(inlineBadge, 'text-[11px]') : large ? 'size-7 text-sm shadow-md ring-2 ring-white' : 'size-6 text-xs shadow-md ring-2 ring-white',
        pinStyle(pin),
      )}
    >
      {pin.n}
    </span>
  );
}

/** Something seen on the photo: a small neutral diamond with a letter (no colour that competes with mapped facts). */
export function ObservationBadge({ id, large = false, inline = false }: { id: string; large?: boolean; inline?: boolean }) {
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center', inline ? inlineBadge : large ? 'size-6' : 'size-5')}>
      <span className={cn('absolute inset-[3px] rotate-45 rounded-[3px] bg-white ring-1 ring-ink/60', !inline && 'shadow-md')} />
      <span className="relative text-[10px] font-bold leading-none text-ink">{id}</span>
    </span>
  );
}

/** Stairs marker: amber square with a step glyph. */
export function StairsBadge({ large = false, inline = false }: { large?: boolean; inline?: boolean }) {
  return (
    <span className={cn('inline-grid shrink-0 place-items-center rounded-[5px] bg-barrier text-white', inline ? inlineBadge : large ? 'size-6 shadow-md ring-2 ring-white' : 'size-5 shadow-md ring-2 ring-white')}>
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

type Tone = 'good' | 'warn' | 'bad' | 'neutral';
type Tile = { icon: LucideIcon; label: string; value: string; tone: Tone };

const toneClass: Record<Tone, string> = { good: 'text-rest', warn: 'text-barrier', bad: 'text-barrier', neutral: 'text-foreground' };
const compassAngle: Record<string, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };

/** Facts of a pin or stairs as rows; facts nobody has mapped are returned separately as one "no data" line. */
function useTiles() {
  const { t } = useI18n();
  return (point: Extract<MapPoint, { type: 'pin' | 'stairs' }>): { tiles: Tile[]; unknown: string[]; chips: string[] } => {
    const tiles: Tile[] = [];
    const unknown: string[] = [];
    const chips: string[] = [];
    if (point.type === 'stairs') {
      const l = point.line;
      if (l.steps !== undefined) tiles.push({ icon: Footprints, label: t('tile.steps'), value: String(l.steps), tone: l.steps <= 2 ? 'warn' : 'bad' });
      else unknown.push(t('tile.steps').toLocaleLowerCase());
      if (l.handrail === 'yes' || l.handrail === 'no') tiles.push({ icon: Grip, label: t('tile.handrail'), value: t(l.handrail === 'yes' ? 'fvalue.yes' : 'fvalue.no'), tone: l.handrail === 'yes' ? 'good' : 'bad' });
      else unknown.push(t('tile.handrail').toLocaleLowerCase());
      if (l.ramp) tiles.push({ icon: Accessibility, label: t('tile.ramp'), value: t('fvalue.yes'), tone: 'good' });
      return { tiles, unknown, chips };
    }
    const pin = point.pin;
    if (pin.kind === 'entrance') {
      const w = pin.wheelchair ?? 'unknown';
      if (w === 'unknown') unknown.push(t('tile.wheelchair').toLocaleLowerCase());
      else tiles.push({ icon: Accessibility, label: t('tile.wheelchair'), value: t(`fvalue.${w}`), tone: w === 'yes' ? 'good' : w === 'limited' ? 'warn' : 'bad' });
      if (pin.steps === undefined) unknown.push(t('tile.steps').toLocaleLowerCase());
      else tiles.push({ icon: Footprints, label: t('tile.steps'), value: pin.steps === 0 ? t('tile.none') : String(pin.steps), tone: pin.steps === 0 ? 'good' : 'bad' });
      if (pin.ramp) tiles.push({ icon: Accessibility, label: t('tile.ramp'), value: t('fvalue.yes'), tone: 'good' });
      if (pin.doorWidth) tiles.push({ icon: DoorOpen, label: t('tile.door'), value: `${pin.doorWidth} cm`, tone: pin.doorWidth >= 90 ? 'good' : pin.doorWidth >= 80 ? 'warn' : 'bad' });
      if (pin.automaticDoor) tiles.push({ icon: DoorOpen, label: t('tile.autoDoor'), value: t('fvalue.yes'), tone: 'good' });
      if (pin.main) chips.push(t('tile.mainEntrance'));
    }
    if (pin.kind === 'stop') {
      for (const m of pin.modes ?? []) chips.push(t(`aerial.${m}`));
      if (pin.platform) chips.push(t('aerial.platform', { code: pin.platform }));
      if (pin.lines?.length) tiles.push({ icon: pin.modes?.includes('tram') ? TramFront : BusFront, label: t('tile.lines'), value: pin.lines.join(', '), tone: 'neutral' });
    }
    if (pin.kind === 'parking') {
      if (pin.disabledSpaces) tiles.push({ icon: Accessibility, label: t('tile.spaces'), value: String(pin.disabledSpaces), tone: 'good' });
      else unknown.push(t('tile.spaces').toLocaleLowerCase());
      if (pin.fee === 'yes' || pin.fee === 'no') tiles.push({ icon: Coins, label: t('tile.fee'), value: t(pin.fee === 'yes' ? 'tile.paid' : 'tile.free'), tone: 'neutral' });
      else unknown.push(t('tile.fee').toLocaleLowerCase());
      if (pin.capacity) tiles.push({ icon: SquareParking, label: t('tile.capacity'), value: String(pin.capacity), tone: 'neutral' });
    }
    if (pin.kind === 'toilet') {
      const w = pin.wheelchair ?? 'unknown';
      if (w === 'unknown') unknown.push(t('tile.wheelchair').toLocaleLowerCase());
      else tiles.push({ icon: Accessibility, label: t('tile.wheelchair'), value: t(`fvalue.${w}`), tone: w === 'yes' ? 'good' : w === 'limited' ? 'warn' : 'bad' });
    }
    return { tiles, unknown, chips };
  };
}

/** Distance and direction from the place, with an arrow pointing that way. */
function Direction({ from, to }: { from: Point; to: Point }) {
  const { t, locale } = useI18n();
  const d = Math.round(distance(from, to));
  const c = compass(from, to);
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <Navigation2 className="size-4 text-primary" style={{ transform: `rotate(${compassAngle[c] ?? 0}deg)` }} aria-hidden />
      <span className="whitespace-nowrap">{formatDistance(d, locale)}</span>
      <span className="font-normal text-muted-foreground">{t(`aerial.dir.${c}` as MessageKey)}</span>
    </span>
  );
}

/** Hover/tap card of a point: a header, one row per mapped fact (icon, label, value), unknowns in one line, distance and source in a footer. */
export function PointCard({ point, overlay }: { point: MapPoint; overlay: AerialOverlay }) {
  const { t, locale } = useI18n();
  const tilesOf = useTiles();
  const place = overlay.place;
  if (point.type === 'place') {
    return (
      <div className="flex items-center gap-2.5">
        <PlaceBadge />
        <div className="min-w-0">
          <p className="text-xs font-medium text-tram">{t('aerial.place')}</p>
          <p className="font-semibold leading-snug">{point.name}</p>
        </div>
      </div>
    );
  }
  if (point.type === 'observation') {
    const o = point.observation;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <ObservationBadge id={o.id} large />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{t(`aerial.obs.${o.kind}`)}</p>
            <p className="font-semibold leading-snug">{o.label}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2">
          <Direction from={place} to={o} />
          <span className="text-xs text-muted-foreground">{t('tile.seen')}</span>
        </div>
      </div>
    );
  }
  const { tiles, unknown, chips } = tilesOf(point);
  const isPin = point.type === 'pin';
  const kindLabel = isPin ? t(`aerial.kind.${point.pin.kind}`) : t('aerial.stairs');
  const name = isPin ? point.pin.name : undefined;
  const url = isPin ? point.pin.sourceUrl : `https://www.openstreetmap.org/${point.line.id.replace(':', '/')}`;
  const sourceName = isPin && point.pin.kind === 'stop' ? 'ZTP GTFS' : 'OpenStreetMap';
  const sourceDate = isPin && point.pin.kind === 'stop' ? overlay.transitObtainedAt : isPin ? point.pin.editedAt : point.line.editedAt;
  const target = isPin ? point.pin : lineMiddle(point.line, place);
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn('flex gap-2.5', name || chips.length ? 'items-start' : 'items-center')}>
        {isPin ? <PinBadge pin={point.pin} large /> : <StairsBadge large />}
        <div className="min-w-0">
          {name ? <p className="text-xs font-medium text-muted-foreground">{kindLabel}</p> : null}
          <p className="font-semibold leading-snug">{name ?? kindLabel}</p>
          {chips.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {chips.map(c => (
                <span key={c} className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">{c}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {tiles.length ? (
        <dl className="flex flex-col divide-y rounded-lg border">
          {tiles.map(tile => (
            <div key={tile.label} className="flex items-start gap-2 px-2.5 py-1.5 text-sm">
              <tile.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <dt className="shrink-0 text-muted-foreground">{tile.label}</dt>
              <dd className={cn('ml-auto min-w-0 text-right font-semibold break-words', toneClass[tile.tone])}>{tile.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {unknown.length ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CircleHelp className="size-3.5 shrink-0" aria-hidden />
          {t('tile.unknown', { list: unknown.join(', ') })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2">
        <Direction from={place} to={target} />
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
          {sourceName}
          {sourceDate ? <span className="text-muted-foreground">· {formatDate(sourceDate, locale)}</span> : null}
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">{t('fact.newTab')}</span>
        </a>
      </div>
    </div>
  );
}

/**
 * A list that shows its first few items and the rest behind "Show all (N)" / "Show less" (Radix Collapsible:
 * aria-expanded, Enter/Space). Short lists render whole. `items` are <li> elements; `frameClassName` styles the
 * box around both parts (e.g. a bordered card), `listClassName` each list.
 */
export function ShowMore({ items, preview = 3, listClassName, frameClassName, restClassName, labelledBy }: {
  items: ReactNode[];
  preview?: number;
  listClassName?: string;
  frameClassName?: string;
  /** Extra classes for the list of hidden items (e.g. a top border to continue a divided list). */
  restClassName?: string;
  labelledBy?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Hiding a single item saves nothing: show everything.
  if (items.length <= preview + 1) {
    return (
      <div className={frameClassName}>
        <ul aria-labelledby={labelledBy} className={listClassName}>{items}</ul>
      </div>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
      <div className={frameClassName}>
        <ul aria-labelledby={labelledBy} className={listClassName}>{items.slice(0, preview)}</ul>
        <CollapsibleContent asChild>
          <ul aria-labelledby={labelledBy} className={cn(listClassName, restClassName)}>{items.slice(preview)}</ul>
        </CollapsibleContent>
      </div>
      <CollapsibleTrigger className="inline-flex min-h-10 w-fit items-center gap-1 rounded-md text-sm font-semibold text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
        {open ? t('card.showLess') : t('card.showAll', { n: items.length })}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>
    </Collapsible>
  );
}
