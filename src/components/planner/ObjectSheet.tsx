'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, ExternalLink, LoaderCircle, Navigation, Store, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AccessFeature, FeatureKey, ObjectSource, PlaceObject, SourceStatus } from '@/lib/explore-types';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { ShowMore } from './AerialParts';
import { AerialSection } from './AerialSection';
import { PartnerBadges, featureStyle } from './Explore';
import { StatusRow } from './FactSheet';
import { Panel } from './Panel';
import { useMediaQuery } from '@/hooks/use-media-query';

/** Facts people most often need; shown as "no data" when no source mentions them. */
const coreKeys: FeatureKey[] = ['step_free_entrance', 'ramp', 'lift', 'door_width', 'accessible_toilet'];
const tone: Record<SourceStatus, 'map' | 'city' | 'partner' | 'report' | 'example'> = { map: 'map', city: 'city', partner: 'partner', unverified: 'report', example: 'example' };
/** For these keys "yes" is the barrier (same rule as featureStyle in Explore). */
const barrierWhenYes = new Set<FeatureKey>(['entrance_steps', 'difficult_building']);

/** Order for the card: barriers first, then the core facts people ask about, other known facts, unknowns last. */
export function featureRank(f: AccessFeature) {
  const barrier = barrierWhenYes.has(f.key) ? f.value === 'yes' || f.value === 'limited' : f.value === 'no' || f.value === 'limited';
  if (barrier) return 0;
  if (f.value === 'unknown') return 3;
  return coreKeys.includes(f.key) ? 1 : 2;
}
const byImportance = (features: AccessFeature[]) => features.map((f, i) => ({ f, i })).sort((a, b) => featureRank(a.f) - featureRank(b.f) || a.i - b.i).map(x => x.f);

export function ObjectSheet({ id, onClose, onRoute, onPhoto, onOwner }: {
  id: string | null;
  onClose: () => void;
  onRoute: (o: PlaceObject) => void;
  onPhoto: (o: PlaceObject) => void;
  onOwner: (o: PlaceObject) => void;
}) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ loading: boolean; object: PlaceObject | null; error: string }>({ loading: false, object: null, error: '' });

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState({ loading: true, object: null, error: '' });
    fetch(`/api/objects/${encodeURIComponent(id)}?locale=${locale}`, { signal: controller.signal })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setState({ loading: false, object: data.object, error: '' });
      })
      .catch(() => !controller.signal.aborted && setState({ loading: false, object: null, error: t('explore.failed') }));
    return () => controller.abort();
  }, [id, locale, t]);

  if (!id) return null;
  const o = state.object;
  const sourceById = new Map((o?.sources ?? []).map(s => [s.id, s]));
  const known = new Set(o?.features.map(f => f.key));
  const missing = coreKeys.filter(k => !known.has(k));

  return (
    <PlaceFrame title={o?.name ?? t('explore.loading')} description={o ? [o.categoryLabel, o.address].filter(Boolean).join(', ') : undefined} onClose={onClose}>
      {state.loading ? (
        <p className="flex items-center gap-2 py-6 text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          {t('explore.loading')}
        </p>
      ) : state.error || !o ? (
        <p role="alert" className="py-6 font-medium">{state.error}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <PartnerBadges partner={o.partner} />
          {o.description ? <p>{o.description}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button className="h-11" onClick={() => onRoute(o)}>
              <Navigation />
              {t('explore.route')}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => onPhoto(o)}>
              <Camera />
              {t('explore.photo')}
            </Button>
            {o.website ? (
              <Button variant="outline" className="h-11" asChild>
                <a href={o.website} target="_blank" rel="noreferrer">
                  {t('explore.website')}
                  <ExternalLink />
                  <span className="sr-only">{t('fact.newTab')}</span>
                </a>
              </Button>
            ) : null}
          </div>

          {o.conflicts.length ? (
            <p className="flex items-start gap-2 rounded-xl bg-barrier-soft p-3 text-sm font-medium text-barrier" role="note">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t('explore.conflictNote', { list: o.conflicts.map(k => t(`feature.${k}`)).join(', ') })}
            </p>
          ) : null}

          <section className="flex flex-col gap-2" aria-labelledby="features-title">
            <h3 id="features-title" className="font-semibold">{t('explore.features')}</h3>
            {o.features.length ? (
              <ShowMore
                labelledBy="features-title"
                preview={3}
                frameClassName="overflow-hidden rounded-xl border bg-card"
                listClassName="flex flex-col divide-y"
                restClassName="border-t"
                items={byImportance(o.features).map((f, i) => {
                  const { icon: Icon, className } = featureStyle(f);
                  const source = sourceById.get(f.sourceId);
                  return (
                    <li key={`${f.key}-${f.sourceId}-${i}`} className="flex items-start gap-3 px-3 py-2">
                      {/* As tall as the first text line, so the icon centres on it. */}
                      <span aria-hidden className="flex h-7 shrink-0 items-center">
                        <span className={cn('grid size-7 place-items-center rounded-full', className)}>
                          <Icon className="size-4" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1 py-0.5">
                        <span className="block font-medium break-words">
                          {t(`feature.${f.key}`)}: <span className="font-bold">{t(`fvalue.${f.value}`)}</span>
                        </span>
                        {f.detail ? <span className="block text-sm break-words text-muted-foreground">{f.detail}</span> : null}
                        {source ? <SourceDot source={source} /> : null}
                      </span>
                    </li>
                  );
                })}
              />
            ) : (
              <p className="text-muted-foreground">{t('explore.noData')}</p>
            )}
            {missing.length ? <p className="text-sm text-muted-foreground">{t('explore.missing', { list: missing.map(k => t(`feature.${k}`)).join(', ') })}</p> : null}
          </section>

          <AerialSection lat={o.lat} lon={o.lon} name={o.name} objectId={o.id} />

          {o.openingHours ? (
            <section className="flex flex-col gap-2" aria-labelledby="hours-title">
              <h3 id="hours-title" className="font-semibold">{t('explore.hours')}</h3>
              {/* OSM opening_hours: one rule per line ("Mo-Fr 10:00-18:00; Sa 10:00-14:00"). */}
              <ul className="flex flex-col gap-0.5 rounded-xl bg-muted/70 p-3 text-sm tabular-nums">
                {o.openingHours.split(/\s*;\s*/).filter(Boolean).map(rule => (
                  <li key={rule} className="break-words">{rule}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="flex flex-col gap-2" aria-labelledby="sources-title">
            <h3 id="sources-title" className="font-semibold">{t('explore.sources')}</h3>
            <ShowMore
              labelledBy="sources-title"
              preview={2}
              listClassName="flex flex-col gap-2"
              restClassName="mt-2"
              items={o.sources.map(s => (
                <li key={s.id}>
                  <StatusRow tone={tone[s.status]} label={t(`status.${s.status}`)}>
                    <span className="block break-words">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-2 [overflow-wrap:anywhere]">
                          {s.label}
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">{s.label}</span>
                      )}
                    </span>
                    {s.note ? <span className="block break-words text-foreground">{s.note}</span> : null}
                    <span className="block">
                      {t('explore.obtained', { date: formatDate(s.obtainedAt, locale) })}
                      {s.editedAt ? `. ${t('explore.edited', { date: formatDate(s.editedAt, locale) })}` : ''}
                      {'. '}
                      {s.confirmedAt ? t('explore.confirmed', { date: formatDate(s.confirmedAt, locale) }) : t('explore.notConfirmed')}.
                    </span>
                  </StatusRow>
                </li>
              ))}
            />
          </section>

          <Button variant="secondary" className="h-11 self-start" onClick={() => onOwner(o)}>
            <Store />
            {t('explore.owner')}
          </Button>
        </div>
      )}
    </PlaceFrame>
  );
}

/**
 * Desktop: a non-modal floating card over the right side of the map, so the list and map stay usable.
 * Phones: the usual bottom drawer.
 */
function PlaceFrame({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const wide = useMediaQuery('(min-width: 1024px)');
  const heading = useRef<HTMLHeadingElement>(null);
  // Captured on first render, before focus moves into the card, so closing returns focus to the opener.
  const opener = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);

  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!wide) return;
    const back = opener.current;
    heading.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog][data-state=open]') && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [wide]);

  if (!wide) {
    return (
      <Panel open onOpenChange={open => !open && onClose()} title={title} description={description}>
        {children}
      </Panel>
    );
  }
  return (
    <section
      aria-labelledby="place-card-title"
      className="fixed bottom-10 right-16 top-4 z-30 flex w-[min(420px,calc(100vw-520px))] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-ink/20 animate-in fade-in slide-in-from-right-4"
    >
      <header className="flex items-start justify-between gap-3 border-b py-3 pl-4 pr-2">
        <div className="min-w-0 pt-1">
          <h2 id="place-card-title" ref={heading} tabIndex={-1} className="text-xl font-bold leading-tight break-words outline-none">{title}</h2>
          {description ? <p className="mt-1 text-sm break-words text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-muted" aria-label={t('explore.close')}>
          <X className="size-5" />
        </button>
      </header>
      <div data-place-card-body className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    </section>
  );
}

function SourceDot({ source }: { source: ObjectSource }) {
  const { t } = useI18n();
  const color = { map: 'bg-primary', city: 'bg-rest', partner: 'bg-drive', unverified: 'bg-report', example: 'bg-barrier' }[source.status];
  return (
    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden className={cn('size-2 rounded-full', color)} />
      {source.label}
      <span className="sr-only">({t(`status.${source.status}`)})</span>
    </span>
  );
}
