'use client';
import { Accessibility, Armchair, BusFront, Check, CarFront, CarTaxiFront, ChevronRight, CircleAlert, Footprints, Info, OctagonAlert, TramFront } from 'lucide-react';
import type { JourneyOption, Leg } from '@/lib/journey-types';
import { clock, distance, duration } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { strip } from '@/lib/journey-ui';
import { cn } from '@/lib/utils';
import { Elevator, stairsIcon } from './icons';

type RideLeg = Extract<Leg, { type: 'ride' }>;
type DriveLeg = Extract<Leg, { type: 'drive' }>;

export function LineBadge({ leg, className }: { leg: RideLeg; className?: string }) {
  const { t } = useI18n();
  const Icon = leg.mode === 'tram' ? TramFront : BusFront;
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm font-bold text-white tabular-nums',
        leg.mode === 'tram' ? 'bg-tram' : 'bg-bus',
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      {leg.line}
      {leg.wheelchair === '1' ? <Accessibility className="size-3.5 opacity-90" aria-label={t('option.accessibleVehicle')} /> : null}
    </span>
  );
}

function DriveBadge({ leg, className }: { leg: DriveLeg; className?: string }) {
  const { t, locale } = useI18n();
  const Icon = leg.mode === 'taxi' ? CarTaxiFront : CarFront;
  return (
    <span className={cn('inline-flex h-7 items-center gap-1 rounded-md bg-drive px-1.5 text-sm font-bold text-white tabular-nums', className)}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{t(leg.mode === 'taxi' ? 'option.taxi' : 'option.car')}</span>
      {duration(leg.seconds, locale)}
    </span>
  );
}

/** Time-proportional bar of the trip with the barriers that matter today. */
function BarrierStrip({ option }: { option: JourneyOption }) {
  const { segments, marks } = strip(option);
  return (
    <div className="relative h-5" aria-hidden="true">
      <div className="absolute inset-x-0 top-1.5 h-2 overflow-hidden rounded-full bg-muted">
        {segments.map((s, i) => (
          <span
            key={i}
            className={cn(
              'absolute inset-y-0',
              s.leg.type === 'walk'
                ? 'bg-[repeating-linear-gradient(90deg,var(--ink)_0_4px,transparent_4px_7px)] opacity-60'
                : s.leg.type === 'drive'
                  ? 'bg-drive'
                  : s.leg.mode === 'tram'
                    ? 'bg-tram'
                    : 'bg-bus',
            )}
            style={{ left: `${s.start * 100}%`, width: `max(3px, ${s.length * 100}%)` }}
          />
        ))}
      </div>
      {marks.slice(0, 8).map(({ fact, at }) => {
        const Icon = fact.kind === 'elevator' ? Elevator : fact.kind === 'bench' ? Armchair : fact.kind === 'toilet' ? Armchair : fact.kind === 'kerb' ? OctagonAlert : stairsIcon(fact.direction);
        return (
          <span
            key={fact.id}
            className={cn(
              'absolute top-0 grid size-5 -translate-x-1/2 place-items-center rounded-full border-2 border-card',
              fact.kind === 'bench' ? 'bg-rest text-white' : fact.kind === 'elevator' ? 'bg-primary text-white' : 'bg-barrier text-white',
            )}
            style={{ left: `clamp(10px, ${at * 100}%, calc(100% - 10px))` }}
          >
            <Icon className="size-3.5" strokeWidth={fact.kind === 'stairs' ? 2.5 : 3} />
          </span>
        );
      })}
    </div>
  );
}

function useStairsText() {
  const { t } = useI18n();
  return (option: JourneyOption) => {
    const parts = [];
    if (option.stairs.down) parts.push(t('option.stairsDown', { n: option.stairs.down }));
    if (option.stairs.up) parts.push(t('option.stairsUp', { n: option.stairs.up }));
    if (option.stairs.unknown) parts.push(t('option.stairsUnknown', { n: option.stairs.unknown }));
    return t('option.stairs', { parts: parts.join(', ') });
  };
}

/**
 * A route option. The card itself opens details (`onOpen`); the separate "Wybierz" button (`onPick`)
 * only makes it the active route on the map. The two are siblings, never a button inside a button.
 * Kept compact so a phone shows two or three options at a glance; the details view has the full story.
 */
export function OptionCard({ option, selected, onOpen, onPick }: { option: JourneyOption; selected: boolean; onOpen: () => void; onPick?: () => void }) {
  const { t, tp, locale } = useI18n();
  const stairsText = useStairsText();
  const vehicles = option.legs.filter((l): l is RideLeg | DriveLeg => l.type !== 'walk');
  const stairsTotal = option.stairs.up + option.stairs.down + option.stairs.unknown;
  const StairsIcon = stairsIcon(option.stairs.unknown || (option.stairs.up && option.stairs.down) ? 'unknown' : option.stairs.up ? 'up' : 'down');
  const firstWalk = option.legs[0]?.type === 'walk' ? option.legs[0] : null;
  const parking = option.legs.find((l): l is DriveLeg => l.type === 'drive' && !!l.parking)?.parking;
  const fare = option.legs.find((l): l is DriveLeg => l.type === 'drive' && !!l.fare)?.fare;
  const title = option.kind === 'walk' ? t('option.walkOnly') : option.kind === 'taxi' ? t('option.taxi') : option.kind === 'car' ? t('option.car') : null;
  const notFit = !option.fits && option.issues.length > 0;
  const issues = option.issues.join(', ');
  const times = option.departure !== null && option.arrival !== null ? `${clock(option.departure)}–${clock(option.arrival)}` : title;
  const total = duration(option.departure !== null && option.arrival !== null ? option.arrival - option.departure : option.duration, locale);
  // In the details view the card is a summary; tapping it is only a pointer shortcut for the List/Map switch next to it.
  const Summary = onPick ? 'button' : 'div';
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/60',
      )}
    >
    <Summary
      {...(onPick ? { type: 'button' as const, 'aria-current': selected ? ('true' as const) : undefined, 'aria-describedby': `${option.id}-hint` } : {})}
      onClick={onOpen}
      className="flex w-full flex-col gap-1 px-3 pt-2 pb-2 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 leading-5">
          {option.departure !== null && option.arrival !== null ? (
            <span className="mr-1 text-base/5 font-bold whitespace-nowrap tabular-nums">
              {clock(option.departure)}
              <span className="px-0.5 font-normal text-muted-foreground">–</span>
              {clock(option.arrival)}
            </span>
          ) : (
            <span className="mr-1 text-base/5 font-bold">{title}</span>
          )}
          {/* A real space keeps "05:08" and "Tramwaj 12" apart in the accessible name too. */}
          {' '}
          <span className="text-[0.8125rem] text-muted-foreground">{option.label}</span>
        </p>
        <span className="shrink-0 text-base/5 font-bold whitespace-nowrap tabular-nums">
          {total}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        {option.kind === 'walk' ? (
          <span className="inline-flex items-center gap-1 font-medium">
            <Footprints className="size-4" aria-hidden />
            {distance(option.walkingDistance, locale)}
          </span>
        ) : (
          <>
            {firstWalk && firstWalk.seconds > 30 ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Footprints className="size-4" aria-hidden />
                <span className="sr-only">{t('option.access')}</span>
                {duration(firstWalk.seconds, locale)}
              </span>
            ) : null}
            {vehicles.map((leg, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 || (firstWalk && firstWalk.seconds > 30) ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden /> : null}
                {leg.type === 'ride' ? <LineBadge leg={leg} className="h-6" /> : <DriveBadge leg={leg} className="h-6" />}
              </span>
            ))}
          </>
        )}
      </div>

      <BarrierStrip option={option} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.8125rem] leading-5">
        {option.kind !== 'walk' ? (
          <span className="text-muted-foreground">
            {t('option.onFoot', { distance: distance(option.walkingDistance, locale) })}
            {option.transfers ? `, ${option.transfers} ${tp('option.transfers', option.transfers)}` : ''}
          </span>
        ) : null}
        {stairsTotal ? (
          <span className="inline-flex items-center gap-1 font-medium text-barrier">
            <StairsIcon className="size-4 shrink-0" />
            {stairsText(option)}
          </span>
        ) : (
          <span className="font-medium text-rest">{t('option.noStairs')}</span>
        )}
        {fare ? (
          <span className="font-semibold">
            {t('taxi.fare', { min: Math.round(fare.min), max: Math.round(fare.max) })}
            <span className="sr-only"> ({t('taxi.estimate')})</span>
          </span>
        ) : null}
        {option.restStops ? (
          <span className="inline-flex items-center gap-1 font-medium text-rest">
            <Armchair className="size-3.5 shrink-0" aria-hidden />
            {tp('option.restStops', option.restStops)}
          </span>
        ) : null}
        {option.rests ? (
          <span className="inline-flex items-center gap-1 text-rest">
            <Armchair className="size-3.5 shrink-0" aria-hidden />
            {tp('option.benches', option.rests)}
          </span>
        ) : null}
        {parking?.disabledSpaces ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <Accessibility className="size-3.5 shrink-0" aria-hidden />
            <span aria-hidden>{tp('option.parkingDisabled', parking.disabledSpaces)}</span>
            <span className="sr-only">{tp('leg.parkingDisabled', parking.disabledSpaces)}</span>
          </span>
        ) : null}
        {!notFit && issues ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Info className="size-3.5 shrink-0" aria-hidden />
            {issues}
          </span>
        ) : null}
      </div>

      {notFit ? (
        // One line on the card; the full sentence stays in the DOM for screen readers and in the tooltip.
        <p className="flex min-w-0 items-center gap-1.5 mt-0.5 rounded-md bg-barrier-soft px-2 py-0.5 text-[0.8125rem] leading-5 font-medium text-barrier" title={t('option.notFit', { issues })}>
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t('option.notFitShort', { issues })}</span>
        </p>
      ) : null}
    </Summary>
      {onPick ? (
        <div className="flex items-center justify-between gap-2 border-t px-1.5 py-0.5">
          {/* Which route these two buttons act on, for anyone reaching them without reading the card. */}
          <span id={`${option.id}-name`} hidden>{[times, total, option.label].filter(Boolean).join(', ')}</span>
          <button
            type="button"
            id={`${option.id}-hint`}
            onClick={onOpen}
            aria-describedby={`${option.id}-name`}
            className="inline-flex min-h-10 min-w-0 items-center gap-0.5 rounded-lg px-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            {t('option.details')}
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onPick}
            aria-pressed={selected}
            aria-describedby={`${option.id}-name`}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border px-3 text-sm font-semibold whitespace-nowrap transition-colors',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary',
            )}
          >
            {selected ? <Check className="size-4" aria-hidden /> : null}
            {selected ? t('option.picked') : t('option.pick')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
