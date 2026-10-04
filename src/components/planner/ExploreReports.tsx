'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareWarning, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MapViewport } from '@/lib/explore-types';
import { distance, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { Report } from '@/lib/schemas';
import { useReportTitle } from './Reports';

type Point = { lat: number; lon: number };

function metres(a: Point, b: Point) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const inBox = (p: Point, [w, s, e, n]: MapViewport['bbox']) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;

/**
 * The "Reports" category of Explore: public user reports instead of places. Follows the visible map area
 * (`bbox`; null = all of Kraków), newest first, and shows the same reports as markers on the map.
 */
export function ExploreReports({ reports, q, bbox, center, viewUpdate, onCity, onOpen, onShow }: {
  reports: Report[];
  q: string;
  bbox: MapViewport['bbox'] | null;
  center: Point;
  /** Increases after the user moved the map, so the count is announced as "updated for the visible area". */
  viewUpdate: number;
  onCity: () => void;
  onOpen: (report: Report) => void;
  onShow: (reports: Report[] | null) => void;
}) {
  const { t, tp, locale } = useI18n();
  const title = useReportTitle();

  const shown = useMemo(() => {
    const needle = q.toLocaleLowerCase(locale);
    return reports
      .filter(r => (bbox ? !!r.location && inBox(r.location, bbox) : true))
      .filter(r => !needle || [r.observation.description, r.comment, r.destination, title(r)].some(s => s?.toLocaleLowerCase(locale).includes(needle)))
      .sort((a, b) => b.obtainedAt.localeCompare(a.obtainedAt));
  }, [reports, bbox, q, locale, title]);
  const outside = bbox ? reports.length - shown.length : 0;

  useEffect(() => onShow(shown), [shown, onShow]);
  useEffect(() => () => onShow(null), [onShow]);

  const [announcement, setAnnouncement] = useState('');
  const lastView = useRef(viewUpdate);
  useEffect(() => {
    const count = tp('explore.r.count', shown.length);
    setAnnouncement(viewUpdate !== lastView.current ? t('explore.updated', { count }) : count);
    lastView.current = viewUpdate;
  }, [shown.length, viewUpdate, t, tp]);

  const capital = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);

  return (
    <section aria-labelledby="explore-report-results" className="flex flex-col gap-3">
      <div className="px-1">
        <h2 id="explore-report-results" className="text-lg font-bold">{tp('explore.r.count', shown.length)}</h2>
        <p className="text-sm text-muted-foreground">{bbox ? t('explore.inView') : t('explore.inCity')}</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {!shown.length ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
          <p className="font-medium">{bbox ? t('explore.r.noneInView') : t('explore.r.empty')}</p>
          {bbox && outside > 0 ? (
            <Button variant="secondary" className="h-11" onClick={onCity}>
              <Search />
              {t('explore.searchCity')}
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map(r => {
            const description = r.observation.description || r.comment;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  className="flex min-h-11 w-full gap-3 rounded-xl border bg-card p-3.5 text-left hover:border-report/60"
                >
                  {r.photoPath ? (
                    <img src={r.photoPath} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg bg-muted object-cover" />
                  ) : (
                    <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-lg bg-report/10 text-report">
                      <MessageSquareWarning className="size-6" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="min-w-0">
                      <span className="block font-semibold">{title(r)}</span>
                      <span className="block text-sm text-muted-foreground">
                        {formatDate(r.obtainedAt, locale)}
                        {r.location ? `, ${t('explore.distance', { distance: distance(metres(center, r.location), locale) })}` : ''}
                      </span>
                    </span>
                    {description ? <span className="line-clamp-2 text-sm">{description}</span> : null}
                    <span className="flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-report/10 px-2 py-0.5 text-xs font-medium text-report">{t('explore.r.unverified')}</span>
                      {r.cityStatus ? (
                        <span className="rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                          {capital(t(`city.${r.cityStatus}`))}
                        </span>
                      ) : null}
                    </span>
                    {r.cityNote ? (
                      <span className="line-clamp-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{t('report.cityReply')}: </span>
                        {r.cityNote}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
