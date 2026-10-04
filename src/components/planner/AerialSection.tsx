'use client';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, CloudSun, ExternalLink, Info, LoaderCircle, MessageCircleQuestion, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { aerialBbox, compass as compassFrom, DEFAULT_WIDTH, inFrame, project, roundPoint, type Bbox } from '@/lib/aerial-geo';
import { autoWidth, nearestStairs, overlaySummary, type AerialAnalysis, type AerialOverlay, type AerialPin, type Weather } from '@/lib/aerial-types';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import type { TransportMode } from '@/lib/journey-types';
import { defaultPreferences, preferencesSchema, type Preferences } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { AerialMap, type AerialPhase } from './AerialMap';
import { ObservationBadge, PinBadge, ShowMore, StairsBadge, useDescribe } from './AerialParts';

/** `pending`: the advice is here, the observations are still being checked on close-ups. */
type Analysis = { status: 'loading' | 'done' | 'failed'; data: AerialAnalysis | null; pending: boolean };
type Line = { analysis?: AerialAnalysis; final?: boolean; error?: string };

/** Today's needs as saved by the planner (same key and parsing); null when the person hasn't set them. */
function savedPreferences(): Preferences | null {
  try {
    const raw = localStorage.getItem('krok-preferences-v1');
    if (!raw) return null;
    const saved = preferencesSchema.safeParse({ ...defaultPreferences, ...JSON.parse(raw) });
    return saved.success ? saved.data : null;
  } catch {
    return null;
  }
}

/** How the person travels as picked in the planner (same key); public transport unless they chose otherwise. */
function savedArrival(): TransportMode {
  try {
    const mode = sessionStorage.getItem('krok-transport');
    return mode === 'walk' || mode === 'taxi' || mode === 'car' ? mode : 'transit';
  } catch {
    return 'transit';
  }
}

/** Reads an NDJSON response line by line as it streams in. */
async function readLines(res: Response, onLine: (line: Line) => void) {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (text) onLine(JSON.parse(text) as Line);
    }
  }
  if (buffer.trim()) onLine(JSON.parse(buffer) as Line);
}

/**
 * The area around a place from above, opened automatically with the card. A pannable orthophoto map with
 * sourced pins (the place's own OSM entrances, stairs, surfaces; ZTP stops; parking; toilets) appears first; the
 * recommendation (which entrance and why, where to arrive from — a stop, or a car park when the person drives —,
 * steps, what to avoid and ask, for today's needs and weather) streams in a few seconds later and the observations
 * on the photo after their close-up check, with one line saying it is automatic and unverified.
 */
export function AerialSection({ lat, lon, name, objectId }: { lat: number; lon: number; name: string; objectId?: string }) {
  const { t, locale } = useI18n();
  const place = useMemo(() => roundPoint({ lat, lon }), [lat, lon]);
  const [overlay, setOverlay] = useState<AerialOverlay | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [analysis, setAnalysis] = useState<Analysis>({ status: 'loading', data: null, pending: false });
  const [attempt, setAttempt] = useState(0);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setOverlay(null);
    fetch(`/api/aerial/overlay?lat=${place.lat}&lon=${place.lon}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => !controller.signal.aborted && setOverlay(data))
      .catch(() => {});
    return () => controller.abort();
  }, [place]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/aerial/weather', { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => !controller.signal.aborted && setWeather(data))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Started with the card (in parallel with the overlay and the photo). The advice streams in first; the
  // observations follow once each is confirmed on a close-up. A cached reading arrives whole at once.
  useEffect(() => {
    const controller = new AbortController();
    // Unmounted or a new place: drop everything. A timeout only ends the wait.
    let cancelled = false;
    const timer = setTimeout(() => controller.abort(), 60_000);
    let got = false;
    setAnalysis({ status: 'loading', data: null, pending: false });
    const body = { ...place, name, locale, objectId: objectId ?? null, preferences: savedPreferences(), arrival: savedArrival() };
    fetch('/api/aerial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error();
        await readLines(res, line => {
          if (!line.analysis || cancelled) return;
          got = true;
          setAnalysis({ status: 'done', data: line.analysis, pending: !line.final });
        });
        if (!got) throw new Error();
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        if (cancelled) return;
        // Without any reading it failed; after the advice alone (stream ended or broke) stop waiting for observations.
        setAnalysis(a => (got ? (a.pending ? { ...a, pending: false } : a) : { status: 'failed', data: null, pending: false }));
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [place, name, locale, objectId, attempt]);

  const widthM = overlay ? autoWidth(overlay) : null;
  const bbox = useMemo(() => aerialBbox(place, widthM ?? DEFAULT_WIDTH), [place, widthM]);
  const placeholder = widthM ? `/api/aerial/image?lat=${place.lat}&lon=${place.lon}&w=${widthM}` : null;
  const phase: AerialPhase = analysis.status === 'loading' ? (overlay ? 'ai' : 'points') : analysis.pending ? 'refine' : 'done';
  const map = (large: boolean) => (
    <AerialMap
      key={`${place.lat},${place.lon}`}
      place={place}
      name={name}
      overlay={overlay}
      widthM={widthM}
      observations={analysis.data?.observations ?? []}
      placeholder={placeholder}
      phase={phase}
      large={large}
      onEnlarge={large ? undefined : () => setEnlarged(true)}
    />
  );
  const statusText = !overlay ? t('aerial.loadingImage') : analysis.status === 'loading' ? t('aerial.analysing') : analysis.status === 'done' ? t('aerial.analysed') : '';

  return (
    <section className="flex flex-col gap-3" aria-labelledby="aerial-title">
      <h3 id="aerial-title" className="font-semibold">{t('aerial.title')}</h3>
      <div className="flex flex-col gap-2">
        {map(false)}
        <p className="sr-only" role="status" aria-live="polite">{statusText}</p>
        {overlay ? <Legend overlay={overlay} bbox={bbox} hasAi={!!analysis.data?.observations.length} /> : null}
      </div>
      {weather ? <WeatherLine weather={weather} /> : null}
      {/* The decision first, then the mapped facts it rests on, then everything else on demand. */}
      <WayIn analysis={analysis} pins={overlay?.pins ?? []} bbox={bbox} onRetry={() => setAttempt(a => a + 1)} />
      {overlay ? <KeyFacts overlay={overlay} bbox={bbox} /> : <Skeleton className="h-16 w-full rounded-xl" />}
      <div className="flex flex-col">
        {overlay && (overlay.pins.length || overlay.lines.some(l => l.kind === 'stairs')) ? <PinList overlay={overlay} bbox={bbox} /> : null}
        <Sources overlay={overlay} />
      </div>

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        {/* Escape closes only the enlarged map, not the place card behind it (it listens on window). */}
        <DialogContent showCloseButton={false} onEscapeKeyDown={e => e.stopPropagation()} className="w-[min(1100px,calc(100vw-1.5rem))] max-w-none gap-3 p-3 sm:max-w-none sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="leading-tight">{t('aerial.enlargedTitle', { name })}</DialogTitle>
              <DialogDescription>{t('aerial.mapLabel')}</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-full" aria-label={t('common.close')}>
                <X className="size-5" />
              </Button>
            </DialogClose>
          </div>
          <div className="mx-auto w-full max-w-[calc((100dvh-10rem)*4/3)]">{map(true)}</div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WeatherLine({ weather }: { weather: Weather }) {
  const { t } = useI18n();
  return (
    <p className="flex items-start gap-2 text-sm">
      <span aria-hidden className="flex h-5 shrink-0 items-center"><CloudSun className="size-4 text-muted-foreground" /></span>
      <span className="min-w-0">
        {t('aerial.weather', { temp: weather.temperature, condition: t(`aerial.cond.${weather.condition}`) })}
        {weather.wind >= 40 ? t('aerial.windy') : ''}.{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline underline-offset-2">
          {t('aerial.weatherCredit')}
          <span className="sr-only">{t('fact.newTab')}</span>
        </a>
      </span>
    </p>
  );
}

// ---------- Text equivalents ----------

function Legend({ overlay, bbox, hasAi }: { overlay: AerialOverlay; bbox: Bbox; hasAi: boolean }) {
  const { t } = useI18n();
  const shown = (p: { lat: number; lon: number }) => inFrame(project(p, bbox), 0);
  const kinds = new Set(overlay.pins.map(p => p.kind));
  const lines = new Set(overlay.lines.filter(l => l.points.some(([lat, lon]) => shown({ lat, lon }))).map(l => l.kind));
  const markers = new Set(overlay.markers.filter(shown).map(m => (m.kind === 'bench' ? 'bench' : 'kerb')));
  const items: [boolean, ReactNode, MessageKey][] = [
    [true, <span className="size-3 rounded-full bg-tram ring-2 ring-tram/30" />, 'aerial.legend.place'],
    [kinds.has('entrance'), <span className="size-3 rounded-sm bg-ink" />, 'aerial.legend.entrance'],
    [kinds.has('stop'), <span className="size-3 rounded-full bg-tram" />, 'aerial.legend.stop'],
    [kinds.has('parking'), <span className="size-3 rounded-sm bg-drive" />, 'aerial.legend.parking'],
    [kinds.has('toilet'), <span className="size-3 rounded-full bg-object" />, 'aerial.legend.toilet'],
    [lines.has('stairs'), <span className="h-1 w-4 rounded-full bg-barrier" />, 'aerial.legend.stairs'],
    [lines.has('rough'), <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" />, 'aerial.legend.rough'],
    [markers.has('bench'), <span className="size-2.5 rounded-full bg-rest" />, 'aerial.legend.bench'],
    [markers.has('kerb'), <span className="size-2.5 rounded-full bg-barrier" />, 'aerial.legend.kerb'],
    [hasAi, <ObservationBadge id="A" inline />, 'aerial.legend.ai'],
  ];
  return (
    <ul aria-label={t('aerial.legend')} className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.filter(([show]) => show).map(([, symbol, key]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span aria-hidden className="grid w-4 place-items-center">{symbol}</span>
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

function FactRow({ pins = [], children }: { pins?: AerialPin[]; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="flex items-start gap-2">
      {/* One text line high, so badges and the dot sit centred on the first line whatever wraps below. */}
      <span className="flex h-5 min-w-6 shrink-0 items-center justify-center">
        {pins.length ? pins.map(p => <PinBadge key={p.n} pin={p} inline />) : <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />}
      </span>
      <span className="min-w-0">
        {pins.length ? <span className="sr-only">{pins.map(p => t('aerial.pin', { n: p.n })).join(', ')}: </span> : null}
        {children}
      </span>
    </li>
  );
}

function KeyFacts({ overlay, bbox }: { overlay: AerialOverlay; bbox: Bbox }) {
  const { t, tp } = useI18n();
  const { where } = useDescribe();
  const s = overlaySummary(overlay, bbox);
  // Entrances (only the place's own, when mapped) and how to arrive first: the preview answers "can I get in, and
  // from where". Nothing is said about entrances when none is mapped on the place's building.
  const rows = [
    s.stepFree.length ? <FactRow key="free" pins={s.stepFree}>{t('aerial.fact.stepFree')}</FactRow> : null,
    s.notAccessible.length ? <FactRow key="no" pins={s.notAccessible}>{t('aerial.fact.notAccessible')}</FactRow> : null,
    s.unknownEntrances.length ? <FactRow key="unknown" pins={s.unknownEntrances}>{t('aerial.fact.entrancesUnknown')}</FactRow> : null,
    s.stop ? <FactRow key="stop" pins={[s.stop]}>{t('aerial.fact.stop', { name: s.stop.name ?? '' })}, {where(s.stop)}</FactRow> : null,
    s.parking ? <FactRow key="parking" pins={[s.parking]}>{t('aerial.fact.parking')}, {where(s.parking)}</FactRow> : null,
    overlay.osmObtainedAt ? (
      <FactRow key="stairs">{s.stairs ? `${tp('aerial.fact.stairs', s.stairs)}${s.stairsWithRail ? `, ${t('aerial.fact.stairsRail', { n: s.stairsWithRail })}` : ''}.` : t('aerial.fact.noStairs')}</FactRow>
    ) : null,
    s.rough ? <FactRow key="rough">{t('aerial.fact.rough')}</FactRow> : null,
    s.kerbs ? <FactRow key="kerbs">{tp('aerial.fact.kerbs', s.kerbs)}.</FactRow> : null,
    s.toilet ? <FactRow key="toilet" pins={[s.toilet]}>{t('aerial.fact.toilet')}, {where(s.toilet)}</FactRow> : null,
    s.benches ? <FactRow key="benches">{tp('aerial.fact.benches', s.benches)}.</FactRow> : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <h4 id="aerial-facts-title" className="text-sm font-semibold">{t('aerial.keyFacts')}</h4>
      <ShowMore items={rows} preview={4} labelledBy="aerial-facts-title" listClassName="flex flex-col gap-1.5 text-sm" restClassName="mt-1.5" />
    </div>
  );
}

/** Model text with [n] references shown as the same numbered badges as on the map. */
function WithPins({ text, pins }: { text: string; pins: AerialPin[] }) {
  const { t } = useI18n();
  return text.split(/\[(\d{1,2})\]/).map((part, i) => {
    if (i % 2 === 0) return part;
    const pin = pins[Number(part) - 1];
    if (!pin) return null;
    return (
      <span key={i}>
        <span aria-hidden><PinBadge pin={pin} inline /></span>
        <span className="sr-only">({t('aerial.pin', { n: pin.n })})</span>
      </span>
    );
  });
}

/** A pin named in the recommendation: its badge, kind and name, and the mapped facts behind the choice. */
function ChosenPin({ label, pin, pins, note }: { label: string; pin: AerialPin; pins: AerialPin[]; note?: string }) {
  const { t } = useI18n();
  const { details, where } = useDescribe();
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden className="pt-0.5"><PinBadge pin={pin} /></span>
      <p className="min-w-0 text-sm">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block font-semibold">
          <span className="sr-only">{t('aerial.pin', { n: pin.n })}: </span>
          {t(`aerial.kind.${pin.kind}`)}
          {pin.name ? `: ${pin.name}` : ''}
        </span>
        <span className="block text-muted-foreground">{[...details(pin), where(pin)].join(' · ')}</span>
        {note ? <span className="mt-1 block"><WithPins text={note} pins={pins} /></span> : null}
      </p>
    </div>
  );
}

function NoteList({ icon, title, items, pins, tone }: { icon: ReactNode; title: string; items: string[]; pins: AerialPin[]; tone?: 'barrier' }) {
  const id = useId();
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p id={id} className={cn('flex items-center gap-1.5 text-sm font-semibold', tone === 'barrier' && 'text-barrier')}>
        {icon}
        {title}
      </p>
      <ul aria-labelledby={id} className="flex flex-col gap-1 text-sm leading-relaxed">
        {items.map(s => (
          <li key={s} className="flex items-start gap-2">
            <span aria-hidden className="flex h-[1lh] w-4 shrink-0 items-center justify-center"><span className="size-1.5 rounded-full bg-muted-foreground" /></span>
            <span className="min-w-0"><WithPins text={s} pins={pins} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The decision: which entrance to use and why, where to arrive from, a few steps, what to avoid and what to ask.
 * Written automatically from the photo and the mapped facts; one quiet line says so (no badges on the photo).
 */
function WayIn({ analysis, pins, bbox, onRetry }: { analysis: Analysis; pins: AerialPin[]; bbox: Bbox; onRetry: () => void }) {
  const { t, tp } = useI18n();
  const data = analysis.data;
  const rec = data?.recommendation ?? null;
  const pinAt = (n: number | null) => (n ? (pins[n - 1] ?? null) : null);
  const entrance = pinAt(rec?.entrance ?? null);
  const from = pinAt(rec?.approachFrom ?? null);
  const basedOn = data
    ? [
        data.basedOn.mobility ? t(`aerial.basedOn.${data.basedOn.mobility}` as MessageKey) : null,
        data.basedOn.weather ? t('aerial.basedOn.weather') : null,
        data.basedOn.reports ? tp('aerial.basedOn.reports', data.basedOn.reports) : null,
        t('aerial.basedOn.map'),
      ].filter(Boolean).join(', ')
    : '';
  return (
    <section aria-labelledby="way-in-title" className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 id="way-in-title" className="text-sm font-semibold">{t('aerial.approach')}</h4>
        <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
          <Sparkles aria-hidden />
          {t('aerial.aiBadge')}
        </Badge>
      </div>
      {analysis.status === 'loading' ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : analysis.status === 'failed' || !data ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="text-muted-foreground">{t('aerial.failed')}</p>
          <Button variant="outline" size="sm" className="h-9" onClick={onRetry}>
            <RotateCcw />
            {t('aerial.retry')}
          </Button>
        </div>
      ) : (
        <>
          {rec ? (
            <>
              {entrance || from ? (
                <div className="flex flex-col gap-3">
                  {entrance ? <ChosenPin label={t('aerial.rec.entrance')} pin={entrance} pins={pins} note={rec.why} /> : null}
                  {from ? <ChosenPin label={t('aerial.rec.from')} pin={from} pins={pins} /> : null}
                </div>
              ) : null}
              {rec.steps.length ? (
                <ol aria-label={t('aerial.rec.steps')} className="flex flex-col gap-1.5 text-sm leading-relaxed">
                  {rec.steps.map((s, i) => (
                    <li key={s} className="flex items-start gap-2">
                      <span aria-hidden className="w-4 shrink-0 text-right font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                      <span className="min-w-0"><WithPins text={s} pins={pins} /></span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <NoteList icon={<TriangleAlert className="size-4" aria-hidden />} title={t('aerial.rec.avoid')} items={rec.avoid} pins={pins} tone="barrier" />
              <NoteList icon={<MessageCircleQuestion className="size-4" aria-hidden />} title={t('aerial.rec.ask')} items={rec.ask} pins={pins} />
            </>
          ) : (
            <p className="text-sm">{t('aerial.rec.none')}</p>
          )}
          <NoteList icon={<CloudSun className="size-4" aria-hidden />} title={t('aerial.today')} items={data.today} pins={pins} />
          {analysis.pending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
              {t('aerial.checking')}
            </p>
          ) : data.observations.length ? (
            <Observations analysis={data} bbox={bbox} />
          ) : null}
          <p className="border-t pt-2 text-xs text-muted-foreground">
            {t('aerial.basedOn', { list: basedOn })}. {t('aerial.disclosure')}
          </p>
        </>
      )}
    </section>
  );
}

function Observations({ analysis, bbox }: { analysis: AerialAnalysis; bbox: Bbox }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={triggerClass}>
        {t('aerial.observations')} ({analysis.observations.length})
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col gap-1.5 pt-1 text-sm">
          {analysis.observations.map(o => (
            <li key={o.id} className="flex items-start gap-2">
              <span aria-hidden className="flex h-5 w-6 shrink-0 items-center justify-center"><ObservationBadge id={o.id} inline /></span>
              <span className="min-w-0">
                <span className="sr-only">{t('aerial.observation', { id: o.id })}: </span>
                {o.label} <span className="text-muted-foreground">({t(`aerial.obs.${o.kind}`)}{inFrame(project(o, bbox)) ? '' : `, ${t('aerial.outside')}`})</span>
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

const triggerClass = 'inline-flex min-h-10 items-center gap-1 rounded-md text-left text-sm font-semibold text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/** Where the photo, the points and the directions come from: one line, details on demand. */
function Sources({ overlay }: { overlay: AerialOverlay | null }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={triggerClass}>
        <Info className="size-4" aria-hidden />
        {t('aerial.statusLabel')}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="rounded-xl bg-muted/70 p-3 text-sm text-muted-foreground">
          {t('aerial.status', { osm: formatDate(overlay?.osmObtainedAt, locale, t('common.unknownDate')), transit: formatDate(overlay?.transitObtainedAt, locale, t('common.unknownDate')) })}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function PinList({ overlay, bbox }: { overlay: AerialOverlay; bbox: Bbox }) {
  const { t } = useI18n();
  const { where, details, stairs, source } = useDescribe();
  const [open, setOpen] = useState(false);
  const stairLines = nearestStairs(overlay);
  const count = overlay.pins.length + stairLines.length;
  const sourceLink = (url: string, text: string) => (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2">
      {text}
      <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">{t('fact.newTab')}</span>
    </a>
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={triggerClass}>
        {t('aerial.allPins', { n: count })}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 flex flex-col divide-y rounded-xl border bg-card text-sm">
          {overlay.pins.map(pin => (
            <li key={pin.n} className="flex items-start gap-3 px-3 py-2">
              <span aria-hidden className="pt-0.5"><PinBadge pin={pin} /></span>
              <span className="min-w-0">
                <span className="block font-medium">
                  <span className="sr-only">{t('aerial.pin', { n: pin.n })}: </span>
                  {t(`aerial.kind.${pin.kind}`)}
                  {pin.name ? `: ${pin.name}` : ''}
                </span>
                <span className="block text-muted-foreground">
                  {[...details(pin), where(pin), inFrame(project(pin, bbox)) ? '' : t('aerial.outside')].filter(Boolean).join(' · ')}
                  {' · '}
                  {sourceLink(pin.sourceUrl, source(pin.kind, pin.editedAt, overlay))}
                </span>
              </span>
            </li>
          ))}
          {stairLines.map(({ line, mid }) => {
            return (
              <li key={line.id} className="flex items-start gap-3 px-3 py-2">
                <span aria-hidden className="grid w-6 place-items-center pt-0.5"><StairsBadge /></span>
                <span className="min-w-0">
                  <span className="block font-medium">{t('aerial.stairs')}</span>
                  <span className="block text-muted-foreground">
                    {[...stairs(line), t('aerial.fromPlace', { distance: where({ distance: mid.distance, compass: compassFrom(overlay.place, mid) }) })].join(' · ')}
                    {' · '}
                    {sourceLink(`https://www.openstreetmap.org/${line.id.replace(':', '/')}`, source('stairs', line.editedAt, overlay))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
