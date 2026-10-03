'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleHelp, Minus, Search, Star, Store, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AccessFeature, FeatureValue, ObjectCategory, ObjectPage, PlaceObjectSummary } from '@/lib/explore-types';
import { distance } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export const categories: ObjectCategory[] = ['museum', 'landmark', 'culture', 'office', 'toilet', 'hotel', 'health', 'park', 'food'];

export const valueStyle: Record<FeatureValue, { icon: typeof Check; className: string }> = {
  yes: { icon: Check, className: 'bg-rest-soft text-rest' },
  limited: { icon: Minus, className: 'bg-barrier-soft text-barrier' },
  no: { icon: X, className: 'bg-barrier-soft text-barrier' },
  unknown: { icon: CircleHelp, className: 'bg-muted text-muted-foreground' },
};

/** For these keys "yes" describes a barrier (e.g. steps at the entrance), so colours invert. */
const barrierKeys = new Set(['entrance_steps', 'difficult_building']);
export function featureStyle(feature: AccessFeature) {
  if (barrierKeys.has(feature.key) && (feature.value === 'yes' || feature.value === 'no')) {
    return feature.value === 'yes' ? { icon: TriangleAlert, className: valueStyle.no.className } : { icon: Check, className: valueStyle.yes.className };
  }
  return valueStyle[feature.value];
}

export function FeatureChip({ feature }: { feature: AccessFeature }) {
  const { t } = useI18n();
  const { icon: Icon, className } = featureStyle(feature);
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', className)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`feature.${feature.key}`)}: {t(`fvalue.${feature.value}`).toLocaleLowerCase()}
    </span>
  );
}

export function PartnerBadges({ partner }: { partner?: PlaceObjectSummary['partner'] }) {
  const { t } = useI18n();
  if (!partner) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {partner.promoted ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          <Star className="size-3" aria-hidden />
          {t('explore.promoted')}
        </span>
      ) : (
        <span className="rounded-md bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">{t('explore.partner')}</span>
      )}
      {partner.example ? <span className="rounded-md bg-barrier-soft px-1.5 py-0.5 text-xs font-semibold text-barrier">{t('explore.example')}</span> : null}
    </span>
  );
}

type Props = {
  center: { lat: number; lon: number };
  selectedId: string | null;
  onResults: (objects: PlaceObjectSummary[]) => void;
  onSelect: (id: string) => void;
  onOwner: () => void;
};

export function Explore({ center, selectedId, onResults, onSelect, onOwner }: Props) {
  const { t, tp, locale } = useI18n();
  const [category, setCategory] = useState<ObjectCategory | 'all'>('museum');
  const [query, setQuery] = useState('');
  const [withData, setWithData] = useState(true);
  const chipRow = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: true });
  const updateEdges = useCallback(() => {
    const el = chipRow.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  const scrollChips = (dir: number) => chipRow.current?.scrollBy({ left: dir * 220, behavior: 'smooth' });
  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges]);
  type State = { loading: boolean; more: boolean; moreFailed: boolean; error: string; objects: PlaceObjectSummary[]; total: number; next: number | null };
  const [state, setState] = useState<State>({ loading: true, more: false, moreFailed: false, error: '', objects: [], total: 0, next: null });
  const sentinel = useRef<HTMLDivElement>(null);
  const origin = useRef(center);

  const params = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ locale, lat: String(origin.current.lat), lon: String(origin.current.lon), limit: '30', offset: String(offset) });
      // A typed search looks across every category; the chips filter browsing.
      const searching = query.trim().length >= 2;
      if (category !== 'all' && !searching) p.set('category', category);
      if (searching) p.set('q', query.trim());
      if (withData) p.set('withData', '1');
      return p;
    },
    [category, query, locale, withData],
  );

  // First page whenever the search changes. The centre is read at that moment; panning alone does not refetch.
  useEffect(() => {
    origin.current = center;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState(s => ({ ...s, loading: true, error: '' }));
      try {
        const res = await fetch(`/api/objects?${params(0)}`, { signal: controller.signal });
        const data = (await res.json()) as ObjectPage & { error?: string };
        if (!res.ok) throw new Error(data.error);
        setState({ loading: false, more: false, moreFailed: false, error: '', objects: data.objects, total: data.total ?? data.objects.length, next: data.nextOffset ?? null });
        onResults(data.objects);
      } catch {
        if (!controller.signal.aborted) {
          setState({ loading: false, more: false, moreFailed: false, error: t('explore.failed'), objects: [], total: 0, next: null });
          onResults([]);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const loadMore = useCallback(async () => {
    if (state.loading || state.more || state.next === null || state.moreFailed) return;
    setState(s => ({ ...s, more: true }));
    try {
      const res = await fetch(`/api/objects?${params(state.next)}`);
      const data = (await res.json()) as ObjectPage;
      if (!res.ok) throw new Error();
      const seen = new Set(state.objects.map(o => o.id));
      const objects = [...state.objects, ...data.objects.filter(o => !seen.has(o.id))];
      setState(s => ({ ...s, more: false, objects, total: data.total ?? s.total, next: data.nextOffset ?? null }));
      onResults(objects);
    } catch {
      // Keep the cursor so "try again" continues where it stopped.
      setState(s => ({ ...s, more: false, moreFailed: true }));
    }
  }, [state.loading, state.more, state.next, state.moreFailed, state.objects, params, onResults]);

  // Infinite scroll: load the next page when the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => entries[0]?.isIntersecting && loadMore(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  return (
    <div className="flex flex-col gap-4 px-4 pb-10">
      <h1 className="sr-only">{t('explore.h1')}</h1>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label={t('explore.search')}
          placeholder={t('explore.searchPlaceholder')}
          className="h-12 rounded-xl bg-card pl-10 text-base"
        />
      </div>
      {/* Category row: scrolls sideways; fading edges and arrow buttons show there is more. */}
      <div className="relative -mx-4">
      <ToggleGroup
        type="single"
        value={category}
        onValueChange={v => v && setCategory(v as ObjectCategory | 'all')}
        aria-label={t('explore.categories')}
        ref={chipRow}
        onScroll={updateEdges}
        className="flex w-auto snap-x justify-start gap-2 overflow-x-auto scroll-smooth px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {(['all', ...categories] as const).map(c => (
          <ToggleGroupItem
            key={c}
            value={c}
            className="h-10 shrink-0 rounded-full! border bg-card px-4 text-sm data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {c === 'all' ? t('explore.all') : t(`cat.${c}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
        {edges.start ? (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
            <button type="button" tabIndex={-1} aria-hidden onClick={() => scrollChips(-1)} className="absolute left-1 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full border bg-card shadow-sm sm:grid">
              <ChevronLeft className="size-4" />
            </button>
          </>
        ) : null}
        {edges.end ? (
          <>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
            <button type="button" tabIndex={-1} aria-hidden onClick={() => scrollChips(1)} className="absolute right-1 top-1/2 hidden size-9 -translate-y-1/2 place-items-center rounded-full border bg-card shadow-sm sm:grid">
              <ChevronRight className="size-4" />
            </button>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <Label htmlFor="with-data" className="text-sm font-normal">{t('explore.withData')}</Label>
        <Switch id="with-data" checked={withData} onCheckedChange={setWithData} />
      </div>

      <section aria-labelledby="explore-results" aria-busy={state.loading} className="flex flex-col gap-3">
        <h2 id="explore-results" className="px-1 text-lg font-bold">
          {state.loading ? t('explore.loading') : tp('explore.count', state.total)}
        </h2>
        <p className="sr-only" role="status">{state.loading ? t('explore.loading') : state.more ? t('explore.loadingMore') : tp('explore.count', state.total)}</p>
        {state.loading && !state.objects.length ? (
          [0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : state.error ? (
          <p className="rounded-xl border bg-card p-4 font-medium">{state.error}</p>
        ) : !state.objects.length ? (
          <p className="rounded-xl border bg-card p-4 text-muted-foreground">{t('explore.empty')}</p>
        ) : (
          <ul className={cn('flex flex-col gap-2', state.loading && 'opacity-60')}>
            {state.objects.map(o => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onSelect(o.id)}
                  aria-current={o.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'flex w-full flex-col gap-2 rounded-xl border bg-card p-3.5 text-left hover:border-primary/60',
                    o.id === selectedId ? 'border-primary ring-2 ring-primary/25' : 'border-border',
                    o.partner?.promoted && 'border-primary/40',
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-semibold">{o.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {o.categoryLabel}
                        {o.distance !== undefined ? `, ${t('explore.distance', { distance: distance(o.distance, locale) })}` : ''}
                      </span>
                    </span>
                    <PartnerBadges partner={o.partner} />
                  </span>
                  {o.highlights.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {o.highlights.map(f => <FeatureChip key={`${f.key}-${f.sourceId}`} feature={f} />)}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t('explore.noData')}</span>
                  )}
                  <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {o.knownCount ? tp('explore.known', o.knownCount) : null}
                    {o.hasConflict ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-barrier">
                        <TriangleAlert className="size-3.5" aria-hidden />
                        {t('explore.conflict')}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinel} aria-hidden="true" />
        {state.more ? (
          <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            {t('explore.loadingMore')}
          </p>
        ) : state.moreFailed ? (
          <div className="flex items-center gap-3 px-1">
            <p className="text-sm font-medium">{t('explore.failed')}</p>
            <Button variant="outline" className="h-10" onClick={() => setState(s => ({ ...s, moreFailed: false }))}>
              {t('results.retry')}
            </Button>
          </div>
        ) : !state.loading && state.objects.length && state.next === null ? (
          <p className="px-1 text-sm text-muted-foreground">{t('explore.end')}</p>
        ) : null}
      </section>
      <Button variant="secondary" className="h-11 self-start" onClick={onOwner}>
        <Store />
        {t('explore.owner')}
      </Button>
    </div>
  );
}
