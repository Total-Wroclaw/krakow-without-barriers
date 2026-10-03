'use client';
import { Accessibility, Armchair, ArrowDown, ArrowUp, BusFront, Check, CarFront, CarTaxiFront, ChevronRight, CircleAlert, Footprints, Info, OctagonAlert, TramFront } from 'lucide-react';
import type { JourneyOption, Leg } from '@/lib/journey-types';
import { clock, distance, duration } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { strip } from '@/lib/journey-ui';
import { cn } from '@/lib/utils';

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

export function DriveBadge({ leg }: { leg: DriveLeg }) {
  const { t, locale } = useI18n();
  const Icon = leg.mode === 'taxi' ? CarTaxiFront : CarFront;
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-drive px-1.5 text-sm font-bold text-white tabular-nums">
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{t(leg.mode === 'taxi' ? 'option.taxi' : 'option.car')}</span>
      {duration(leg.seconds, locale)}
    </span>
  );
}

/** Time-proportional bar of the trip with the barriers that matter today. */
export function BarrierStrip({ option }: { option: JourneyOption }) {
  const { segments, marks } = strip(option);
  return (
    <div className="relative mt-1 h-7" aria-hidden="true">
      <div className="absolute inset-x-0 top-4 h-2 overflow-hidden rounded-full bg-muted">
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
        const Icon = fact.kind === 'bench' ? Armchair : fact.kind === 'toilet' ? Armchair : fact.kind === 'kerb' ? OctagonAlert : fact.direction === 'up' ? ArrowUp : ArrowDown;
        return (
          <span
            key={fact.id}
            className={cn(
              'absolute top-0 grid size-5 -translate-x-1/2 place-items-center rounded-full border-2 border-card',
              fact.kind === 'bench' ? 'bg-rest text-white' : 'bg-barrier text-white',
            )}
            style={{ left: `clamp(10px, ${at * 100}%, calc(100% - 10px))` }}
          >
            <Icon className="size-3" strokeWidth={3} />
          </span>
        );
      })}
    </div>
  );
}

export function useStairsText() {
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
 */
export function OptionCard({ option, selected, onOpen, onPick }: { option: JourneyOption; selected: boolean; onOpen: () => void; onPick?: () => void }) {
  const { t, tp, locale } = useI18n();
  const stairsText = useStairsText();
  const vehicles = option.legs.filter((l): l is RideLeg | DriveLeg => l.type !== 'walk');
  const stairsTotal = option.stairs.up + option.stairs.down + option.stairs.unknown;
  const firstWalk = option.legs[0]?.type === 'walk' ? option.legs[0] : null;
  const parking = option.legs.find((l): l is DriveLeg => l.type === 'drive' && !!l.parking)?.parking;
  const fare = option.legs.find((l): l is DriveLeg => l.type === 'drive' && !!l.fare)?.fare;
  const title = option.kind === 'walk' ? t('option.walkOnly') : option.kind === 'taxi' ? t('option.taxi') : option.kind === 'car' ? t('option.car') : null;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/60',
      )}
    >
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      aria-describedby={`${option.id}-hint`}
      className="flex w-full flex-col gap-2 p-4 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {option.departure !== null && option.arrival !== null ? (
            <p className="text-lg font-bold tabular-nums">
              {clock(option.departure)}
              <span className="px-1 font-normal text-muted-foreground">–</span>
              {clock(option.arrival)}
            </p>
          ) : (
            <p className="text-lg font-bold">{title}</p>
          )}
          <p className="text-sm text-muted-foreground">{option.label}</p>
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-xl font-bold tabular-nums">{duration(option.departure !== null && option.arrival !== null ? option.arrival - option.departure : option.duration, locale)}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
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
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 || (firstWalk && firstWalk.seconds > 30) ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden /> : null}
                {leg.type === 'ride' ? <LineBadge leg={leg} /> : <DriveBadge leg={leg} />}
              </span>
            ))}
          </>
        )}
      </div>

      <BarrierStrip option={option} />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {option.kind !== 'walk' ? (
          <span className="text-muted-foreground">
            {t('option.onFoot', { distance: distance(option.walkingDistance, locale) })}
            {option.transfers ? `, ${option.transfers} ${tp('option.transfers', option.transfers)}` : ''}
          </span>
        ) : null}
        {stairsTotal ? (
          <span className="inline-flex items-center gap-1 font-medium text-barrier">
            {option.stairs.down ? <ArrowDown className="size-4" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
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
            <Armchair className="size-4" aria-hidden />
            {tp('option.restStops', option.restStops)}
          </span>
        ) : null}
        {option.rests ? (
          <span className="inline-flex items-center gap-1 text-rest">
            <Armchair className="size-4" aria-hidden />
            {tp('option.benches', option.rests)}
          </span>
        ) : null}
        {parking?.disabledSpaces ? (
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            <Accessibility className="size-4" aria-hidden />
            {tp('leg.parkingDisabled', parking.disabledSpaces)}
          </span>
        ) : null}
      </div>

      {!option.fits && option.issues.length ? (
        <p className="flex items-start gap-2 rounded-lg bg-barrier-soft px-3 py-2 text-sm font-medium text-barrier">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t('option.notFit', { issues: option.issues.join(', ') })}</span>
        </p>
      ) : option.issues.length ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{option.issues.join(', ')}</span>
        </p>
      ) : null}
    </button>
      {onPick ? (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2">
          <span id={`${option.id}-hint`} className="flex items-center gap-1 text-sm text-muted-foreground">
            {t('option.details')}
            <ChevronRight className="size-4" aria-hidden />
          </span>
          <button
            type="button"
            onClick={onPick}
            aria-pressed={selected}
            className={cn(
              'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:border-primary',
            )}
          >
            {selected ? <Check className="size-4" aria-hidden /> : null}
            {selected ? t('option.picked') : t('option.pick')}
          </button>
        </div>
      ) : (
        <span id={`${option.id}-hint`} hidden />
      )}
    </div>
  );
}
