'use client';
import type { ReactNode } from 'react';
import { Camera, ExternalLink, MessageSquareWarning, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CityFact } from '@/lib/city-types';
import { handrail } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { factTitle } from '@/lib/journey-ui';
import type { Report } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { Panel } from './Panel';
import { useReportTitle } from './Reports';

const tones = {
  map: 'bg-primary',
  city: 'bg-rest',
  partner: 'bg-drive',
  report: 'bg-report',
  example: 'bg-barrier',
};

/** Small status dot with a plain-language label. Details live under it. */
export function StatusRow({ tone, label, children }: { tone: keyof typeof tones; label: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-muted/70 p-3 text-sm">
      <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', tones[tone])} />
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}

const surfaceKey: Record<string, MessageKey> = {
  paving_stones: 'surface.paving_stones',
  asphalt: 'surface.asphalt',
  sett: 'surface.sett',
  gravel: 'surface.gravel',
  concrete: 'surface.concrete',
  compacted: 'surface.compacted',
};

/** A user report about this fact that contradicts what the map says. */
function conflictingReports(fact: CityFact, reports: Report[]) {
  const mapRail = handrail(fact.tags);
  return reports.filter(r => {
    if (r.locationId !== fact.id) return false;
    const o = r.observation;
    if (fact.kind === 'stairs' && o.kind === 'stairs' && o.handrail !== 'unknown' && mapRail !== 'unknown' && o.handrail !== mapRail) return true;
    // A report of stairs where the map has a step-free entrance, or vice versa.
    if (fact.kind === 'entrance' && fact.tags.wheelchair === 'yes' && o.kind === 'stairs') return true;
    return false;
  });
}

export function FactSheet({ fact, reports, onClose, onReport, onOpenReport }: {
  fact: CityFact | null;
  reports: Report[];
  onClose: () => void;
  onReport: (fact: CityFact) => void;
  onOpenReport: (report: Report) => void;
}) {
  const { t, tp, locale } = useI18n();
  const reportTitle = useReportTitle();
  if (!fact) return null;
  const rail = handrail(fact.tags);
  const rows: [string, string][] = [];
  if (fact.kind === 'stairs') {
    rows.push([t('fact.direction'), t(fact.direction === 'down' ? 'fact.down' : fact.direction === 'up' ? 'fact.up' : 'fact.unknownDir')]);
    rows.push([t('fact.steps'), fact.tags.step_count ?? t('fact.unknownF')]);
    rows.push([t('fact.rail'), t(rail === 'yes' ? 'fact.yesThere' : rail === 'no' ? 'fact.noThere' : 'fact.unknownF')]);
    if (fact.tags.ramp === 'yes' || fact.tags['ramp:wheelchair'] === 'yes') rows.push([t('fact.ramp'), t('fact.yesThere')]);
  }
  if (fact.kind === 'bench') {
    rows.push([t('fact.backrest'), t(fact.tags.backrest === 'yes' ? 'fact.yesThere' : fact.tags.backrest === 'no' ? 'fact.noThere' : 'fact.unknownN')]);
  }
  if (fact.kind === 'entrance') {
    const w = fact.tags.wheelchair;
    rows.push([t('fact.wheelchair'), t(w === 'yes' ? 'fact.yes' : w === 'limited' ? 'fact.partly' : w === 'no' ? 'fact.no' : 'fact.unknownN')]);
  }
  const surface = fact.tags.surface;
  rows.push([t('fact.surface'), surface ? (surfaceKey[surface] ? t(surfaceKey[surface]) : surface) : t('fact.unknownF')]);
  const linked = reports.filter(r => r.locationId === fact.id);
  const conflicts = conflictingReports(fact, reports);
  const sourceTone = fact.status === 'osm' ? 'map' : fact.status === 'unverified' ? 'report' : fact.status;
  const sourceStatus = fact.status === 'osm' ? t('fact.osmStatus') : t(`status.${fact.status}`);

  return (
    <Panel open onOpenChange={open => !open && onClose()} title={factTitle(fact, t, tp)}>
      <div className="flex flex-col gap-5 pt-1">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {rows.map(([term, value]) => (
            <div key={term}>
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="text-base font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {conflicts.length ? (
          <p className="flex items-start gap-2 rounded-xl bg-barrier-soft p-3 text-sm font-medium text-barrier" role="note">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('fact.conflict')}
          </p>
        ) : null}

        <StatusRow tone={sourceTone} label={sourceStatus}>
          {fact.sourceLabel ? <p>{fact.sourceLabel}</p> : null}
          {t(fact.status === 'osm' ? 'fact.osmDetail' : 'fact.sourceDetail', {
            obtained: formatDate(fact.obtainedAt, locale),
            edited: formatDate(fact.editedAt, locale, t('common.unknownDate')),
            confirmed: fact.confirmedAt ? formatDate(fact.confirmedAt, locale) : t('fact.none'),
          })}
        </StatusRow>

        {linked.map(r => (
          <button key={r.id} type="button" onClick={() => onOpenReport(r)} className="text-left">
            <StatusRow tone="report" label={t('status.unverified')}>
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <MessageSquareWarning className="size-4 text-report" aria-hidden />
                {reportTitle(r)}
              </span>
              {r.observation.description} {t('report.addedOn', { date: formatDate(r.obtainedAt, locale) })}
            </StatusRow>
          </button>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button className="h-11" onClick={() => onReport(fact)}>
            <Camera />
            {t('fact.photo')}
          </Button>
          {fact.sourceUrl ? <Button variant="outline" className="h-11" asChild>
            <a href={fact.sourceUrl} target="_blank" rel="noreferrer">
              {t(fact.status === 'osm' ? 'fact.osm' : 'fact.source')}
              <ExternalLink />
              <span className="sr-only">{t('fact.newTab')}</span>
            </a>
          </Button> : null}
        </div>
      </div>
    </Panel>
  );
}
