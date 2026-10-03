'use client';
import { useState } from 'react';
import { Accessibility, Armchair, ArrowDown, ArrowUp, Grid3x3, OctagonAlert, Toilet, CarFront, CarTaxiFront, ChevronDown, CircleDot, DoorOpen, ExternalLink, Footprints, MapPin, MessageSquareWarning, SquareParking } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CityFact } from '@/lib/city-types';
import type { JourneyOption, Leg, WalkLeg } from '@/lib/journey-types';
import type { Report } from '@/lib/schemas';
import { clock, distance, duration } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { factTitle } from '@/lib/journey-ui';
import { cn } from '@/lib/utils';
import { LineBadge } from './OptionCard';
import { useReportTitle } from './Reports';

type Props = {
  option: JourneyOption;
  reports: Report[];
  onFact: (fact: CityFact) => void;
  onReport: (report: Report) => void;
};

const lineClass = (leg: Leg) =>
  leg.type === 'walk' ? 'border-dotted border-ink/50' : leg.type === 'drive' ? 'border-drive' : leg.mode === 'tram' ? 'border-tram' : 'border-bus';

export function JourneyDetail({ option, reports, onFact, onReport }: Props) {
  const { t } = useI18n();
  const reportTitle = useReportTitle();
  let clockCursor = option.departure;
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col" aria-label={t('leg.legs')}>
        {option.legs.map((leg, i) => {
          const start = leg.type === 'ride' ? leg.departure : (leg.departure ?? clockCursor);
          clockCursor = leg.type === 'ride' ? leg.arrival : start !== null ? start + leg.seconds : null;
          return (
            <li key={i} className="relative grid grid-cols-[3.25rem_1fr] gap-x-3">
              <span className="pt-0.5 text-right text-sm font-semibold tabular-nums">{start !== null ? clock(start) : ''}</span>
              <div className={cn('relative border-l-4 pb-6 pl-4', lineClass(leg))}>
                <span aria-hidden className="absolute -left-[9px] top-1 size-3.5 rounded-full border-[3px] border-ink bg-card" />
                {leg.type === 'walk' ? (
                  <WalkPart leg={leg} next={option.legs[i + 1]} onFact={onFact} last={i === option.legs.length - 1} />
                ) : leg.type === 'drive' ? (
                  <DrivePart leg={leg} />
                ) : (
                  <RidePart leg={leg} />
                )}
              </div>
            </li>
          );
        })}
        <li className="grid grid-cols-[3.25rem_1fr] gap-x-3">
          <span className="text-right text-sm font-semibold tabular-nums">{option.arrival !== null ? clock(option.arrival) : ''}</span>
          <p className="flex items-center gap-2 font-semibold">
            <MapPin className="size-5 text-primary" aria-hidden />
            {t('leg.arrived')}
          </p>
        </li>
      </ol>

      {reports.length ? (
        <section className="mt-6 flex flex-col gap-2" aria-labelledby="route-reports">
          <h3 id="route-reports" className="font-semibold">{t('leg.reports')}</h3>
          {reports.map(r => (
            <button key={r.id} type="button" onClick={() => onReport(r)} className="flex min-h-12 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left hover:border-report">
              <MessageSquareWarning className="size-5 shrink-0 text-report" aria-hidden />
              <span className="min-w-0">
                <span className="block font-medium">{reportTitle(r)}</span>
                <span className="block truncate text-sm text-muted-foreground">{r.observation.description}</span>
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** Identical chips (e.g. three plain benches) collapse into one with a count. */
function groupFacts(facts: CityFact[], title: (f: CityFact) => string) {
  const groups = new Map<string, { fact: CityFact; count: number }>();
  for (const f of facts) {
    const key = f.kind === 'stairs' || f.restAfterMinutes ? f.id : `${f.kind}:${title(f)}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { fact: f, count: 1 });
  }
  return [...groups.values()];
}

function FactChip({ fact, onFact, count = 1 }: { fact: CityFact; onFact: (f: CityFact) => void; count?: number }) {
  const { t, tp } = useI18n();
  const Icon = fact.kind === 'bench' ? Armchair : fact.kind === 'toilet' ? Toilet : fact.kind === 'entrance' ? DoorOpen : fact.kind === 'kerb' ? OctagonAlert : fact.kind === 'surface' ? Grid3x3 : fact.direction === 'up' ? ArrowUp : fact.direction === 'down' ? ArrowDown : CircleDot;
  return (
    <button
      type="button"
      onClick={() => onFact(fact)}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-medium',
        fact.kind === 'stairs' || fact.kind === 'kerb' || fact.kind === 'surface' ? 'bg-barrier-soft text-barrier' : fact.kind === 'bench' ? (fact.restAfterMinutes ? 'bg-rest text-white' : 'bg-rest-soft text-rest') : 'bg-accent text-accent-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {factTitle(fact, t, tp)}
      {count > 1 ? <span className="tabular-nums">×{count}</span> : null}
    </button>
  );
}

function WalkPart({ leg, next, onFact, last }: { leg: WalkLeg; next?: Leg; onFact: (f: CityFact) => void; last: boolean }) {
  const { t, tp, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const inline = new Set(leg.steps.map(s => s.factId).filter(Boolean));
  const barrier = (k: CityFact['kind']) => k === 'stairs' || k === 'kerb' || k === 'surface';
  const stairs = leg.facts.filter(f => barrier(f.kind));
  const others = leg.facts.filter(f => !barrier(f.kind) && !inline.has(f.id));
  const target = next?.type === 'ride' ? t('leg.toStop', { name: next.from.name }) : next?.type === 'drive' ? t('leg.toPlace', { name: next.from.name }) : last ? t('leg.toGoal') : t('leg.toPlace', { name: leg.to.name });
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">{leg.from.name}</p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Footprints className="size-4 shrink-0" aria-hidden />
        {t('leg.walkTo', { target, distance: distance(leg.distance, locale), duration: duration(leg.seconds, locale) })}
      </p>
      {stairs.length ? (
        <div className="flex flex-wrap gap-2">
          {stairs.map(f => <FactChip key={f.id} fact={f} onFact={onFact} />)}
        </div>
      ) : null}
      {others.length ? (
        <div className="flex flex-wrap gap-2">
          {groupFacts(others, f => factTitle(f, t, tp)).map(({ fact: f, count }) => <FactChip key={f.id} fact={f} count={count} onFact={onFact} />)}
        </div>
      ) : null}
      {leg.steps.length > 1 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary">
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
            {open ? t('leg.hideSteps') : tp('leg.showSteps', leg.steps.length)}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ol className="mt-1 flex flex-col divide-y rounded-lg border bg-card">
              {leg.steps.map((step, i) => {
                const fact = step.factId ? leg.facts.find(f => f.id === step.factId) : undefined;
                return (
                  <li key={i} className={cn('flex items-start justify-between gap-3 px-3 py-2.5 text-sm', fact && 'bg-barrier-soft/50')}>
                    <span className="min-w-0">
                      {step.instruction}
                      {fact ? (
                        <button type="button" onClick={() => onFact(fact)} className="mt-1 block text-sm font-semibold text-barrier underline underline-offset-2">
                          {t('leg.stairsDetails')}
                        </button>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{distance(step.distance, locale)}</span>
                  </li>
                );
              })}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function DrivePart({ leg }: { leg: Extract<Leg, { type: 'drive' }> }) {
  const { t, tp, locale } = useI18n();
  const Icon = leg.mode === 'taxi' ? CarTaxiFront : CarFront;
  const p = leg.parking;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">{leg.from.name}</p>
      <p className="flex items-center gap-2 text-sm">
        <Icon className="size-4 shrink-0 text-drive" aria-hidden />
        {t('leg.drive', { mode: t(leg.mode === 'taxi' ? 'option.taxi' : 'option.car'), distance: distance(leg.distance, locale), duration: duration(leg.seconds, locale) })}
      </p>
      <p className="text-sm text-muted-foreground">{t('leg.driveEstimate')}</p>
      {leg.fare ? (
        <p className="text-sm">
          <span className="font-semibold">{t('taxi.fare', { min: Math.round(leg.fare.min), max: Math.round(leg.fare.max) })}</span>
          <span className="text-muted-foreground">
            {' '}({leg.fare.basis},{' '}
            <a href={leg.fare.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {t('explore.sources').toLocaleLowerCase()}
              <span className="sr-only"> {t('fact.newTab')}</span>
            </a>
            )
          </span>
        </p>
      ) : null}
      {p ? (
        <div className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
          <SquareParking className="mt-0.5 size-5 shrink-0 text-drive" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">{p.name}</p>
            <p className="text-muted-foreground">
              {p.disabledSpaces ? (
                <span className="inline-flex items-center gap-1 font-medium text-primary">
                  <Accessibility className="size-4" aria-hidden />
                  {tp('leg.parkingDisabled', p.disabledSpaces)}
                </span>
              ) : null}
              {p.fee !== 'unknown' ? <span>{p.disabledSpaces ? ', ' : ''}{t(p.fee === 'yes' ? 'leg.parkingFee' : 'leg.parkingFree')}</span> : null}
            </p>
            <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
              OpenStreetMap
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">{t('fact.newTab')}</span>
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RidePart({ leg }: { leg: Extract<Leg, { type: 'ride' }> }) {
  const { t, tp, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const between = leg.stops.slice(1, -1);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">{leg.from.name}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <LineBadge leg={leg} />
        <span>{t('leg.direction', { headsign: leg.headsign })}</span>
      </p>
      {leg.wheelchair === '1' ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Accessibility className="size-4" aria-hidden />
          {t('leg.vehicleOk')}
        </p>
      ) : null}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-primary" disabled={!between.length}>
          {between.length ? <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden /> : null}
          {duration(leg.arrival - leg.departure, locale)}, {leg.stops.length - 1} {tp('leg.stops', leg.stops.length - 1)}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
            {between.map((s, i) => <li key={`${s.id}-${i}`}>{s.name}</li>)}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <p className="text-sm">
        {t('leg.alight')} <span className="font-semibold">{leg.to.name}</span> {t('leg.at', { time: clock(leg.arrival) })}
      </p>
    </div>
  );
}
