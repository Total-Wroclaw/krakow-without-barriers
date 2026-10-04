'use client';
import type { Ref } from 'react';
import { ArrowLeft, List, Map as MapIcon, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CityFact, CityPlace } from '@/lib/city-types';
import { useI18n } from '@/lib/i18n/client';
import type { JourneyOption } from '@/lib/journey-types';
import type { Report } from '@/lib/schemas';
import { JourneyDetail } from './JourneyDetail';
import { OptionCard } from './OptionCard';

type Props = {
  option: JourneyOption;
  to: CityPlace | null;
  reports: Report[];
  mobileView: 'map' | 'list';
  onMobileView: (view: 'map' | 'list') => void;
  onBack: () => void;
  /** Absent in the embed widget. */
  onShare?: () => void;
  onFact: (fact: CityFact) => void;
  onReport: (report: Report) => void;
  headingRef: Ref<HTMLHeadingElement>;
};

/**
 * One route, step by step. A view of its own next to the list of options (which stays mounted,
 * hidden), so going back finds the list exactly where it was left.
 */
export function RouteDetails({ option, to, reports, mobileView, onMobileView, onBack, onShare, onFact, onReport, headingRef }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4 px-4 pb-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" className="-ml-2 h-11" onClick={onBack}>
          <ArrowLeft />
          {t('results.all')}
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onShare ? (
            <Button variant="outline" className="h-11 bg-card max-lg:w-11 max-lg:px-0" onClick={onShare}>
              <Share2 />
              {/* Below lg the list/map switch shares the row, so the label stays for screen readers only. */}
              <span className="max-lg:sr-only">{t('share.button')}</span>
            </Button>
          ) : null}
          <ToggleGroup type="single" value={mobileView} onValueChange={v => v && onMobileView(v as 'map' | 'list')} className="rounded-lg border bg-card p-0.5 lg:hidden" aria-label={t('results.view')}>
            <ToggleGroupItem value="list" className="h-10 gap-1.5 px-3"><List />{t('results.list')}</ToggleGroupItem>
            <ToggleGroupItem value="map" className="h-10 gap-1.5 px-3"><MapIcon />{t('results.map')}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only">{t('results.detailH1')}</h1>
      <OptionCard option={option} selected onOpen={() => onMobileView(mobileView === 'map' ? 'list' : 'map')} />
      {option.rideLinks?.length ? (
        <section className="flex flex-col gap-2" aria-labelledby="ride-apps">
          <h2 id="ride-apps" className="px-1 text-sm font-semibold">{t('taxi.open')}</h2>
          <div className="flex flex-wrap gap-2">
            {option.rideLinks.map(link => (
              <Button key={link.provider} variant={link.provider === 'uber' ? 'default' : 'outline'} className="h-11" asChild>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {({ uber: 'Uber', bolt: 'Bolt', freenow: 'FREENOW' } as const)[link.provider]}
                  <span className="sr-only"> {t('fact.newTab')}</span>
                </a>
              </Button>
            ))}
            {to ? (
              <Button
                variant="ghost"
                className="h-11"
                onClick={async () => {
                  await navigator.clipboard.writeText(to.name).catch(() => {});
                  toast.success(t('taxi.copied'));
                }}
              >
                {t('taxi.copyDestination')}
              </Button>
            ) : null}
          </div>
          <p className="px-1 text-xs text-muted-foreground">{t('taxi.linksNote')}</p>
        </section>
      ) : null}
      <h2 className="px-1 text-lg font-bold">{t('results.steps')}</h2>
      <JourneyDetail option={option} reports={reports} onFact={onFact} onReport={onReport} />
    </div>
  );
}
