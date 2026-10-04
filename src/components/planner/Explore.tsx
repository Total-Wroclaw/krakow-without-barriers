'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleHelp, Minus, Search, Star, Store, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AccessFeature, FeatureValue, MapViewport, ObjectCategory, ObjectPage, PlaceObjectSummary } from '@/lib/explore-types';
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
  /** The user's point for shown distances (start of the journey, or the map centre). */
  center: { lat: number; lon: number };
  /** The visible map area; results follow it after the user pans or zooms. */
  viewport: MapViewport | null;
  selectedId: string | null;
  /** `fit` asks the map to bring the places into view (only after an explicit new search, never after a pan). */
  onResults: (objects: PlaceObjectSummary[], fit: boolean) => void;
  onSelect: (id: string) => void;
  onOwner: () => void;
};

const PAGE = 30;
/** Start loading the next page while the end of the list is still this far below the visible part. */
const PREFETCH_PX = 1200;
/** Wait this long after the map stops before asking for the new area. */
const VIEW_DEBOUNCE_MS = 400;

type Area = { bbox: MapViewport['bbox']; center: MapViewport['center']; zoom: number };
type Request = {
  seq: number;
  category: ObjectCategory | 'all';
  q: string;
  withData: boolean;
  /** 'view': only the visible map area; 'city': all of Kraków ("search all of Kraków"). */
  scope: 'view' | 'city';
  area: Area | null;
  origin: { lat: number; lon: number };
  reason: 'initial' | 'search' | 'view';
};
type List = { request: Request; objects: PlaceObjectSummary[]; total: number; next: number | null; outside: number };

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** True when the camera really moved (not a resize or a tap without a drag). */
function moved(a: Area | null, b: Area) {
  if (!a) return true;
  const w = a.bbox[2] - a.bbox[0];
  const h = a.bbox[3] - a.bbox[1];
  return Math.abs(a.zoom - b.zoom) > 0.05 || Math.abs(a.center.lon - b.center.lon) > w * 0.02 || Math.abs(a.center.lat - b.center.lat) > h * 0.02;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

function pageUrl(r: Request, offset: number, locale: string) {
  const p = new URLSearchParams({ locale, limit: String(PAGE), offset: String(offset), lat: String(round(r.origin.lat)), lon: String(round(r.origin.lon)) });
  // A typed search looks across every category; the chips filter browsing.
  if (r.q) p.set('q', r.q);
  else if (r.category !== 'all') p.set('category', r.category);
  if (r.withData) p.set('withData', '1');
  if (r.area) {
    p.set('center', `${round(r.area.center.lat)},${round(r.area.center.lon)}`);
    const [w, s, e, n] = [clamp(r.area.bbox[0], -180, 180), clamp(r.area.bbox[1], -90, 90), clamp(r.area.bbox[2], -180, 180), clamp(r.area.bbox[3], -90, 90)];
    if (r.scope === 'view' && w < e && s < n) p.set('bbox', [w, s, e, n].map(round).join(','));
  }
  return `/api/objects?${p}`;
}

async function fetchPage(r: Request, offset: number, locale: string, signal: AbortSignal) {
  const res = await fetch(pageUrl(r, offset, locale), { signal });
  const data = (await res.json()) as ObjectPage & { error?: string };
  if (!res.ok) throw new Error(data.error);
  return data;
}

/** "All" by default; a link may preselect one (?category=museum). Explore only renders in the browser. */
function initialCategory(): ObjectCategory | 'all' {
  const asked = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('category');
  return categories.find(c => c === asked) ?? 'all';
}

export function Explore({ center, viewport, selectedId, onResults, onSelect, onOwner }: Props) {
  const { t, tp, locale } = useI18n();
  const [category, setCategory] = useState<ObjectCategory | 'all'>(initialCategory);
  const [query, setQuery] = useState('');
  const [withData, setWithData] = useState(true);
  const q = query.trim().length >= 2 ? query.trim() : '';
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

  const [request, setRequest] = useState<Request | null>(null);
  const [list, setList] = useState<List | null>(null);
  const [first, setFirst] = useState<{ loading: boolean; error: string }>({ loading: true, error: '' });
  const [more, setMore] = useState<'idle' | 'loading' | 'error'>('idle');
  const [announcement, setAnnouncement] = useState('');
  const section = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLElement | null>(null);
  // Mirrors of state read by async code, so a stale closure never starts a duplicate or outdated request.
  const listRef = useRef<List | null>(null);
  const firstBusy = useRef(true);
  const moreBusy = useRef(false);
  const moreFailed = useRef(false);
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  const latestView = useRef<Area | null>(viewport);
  const centerRef = useRef(center);
  centerRef.current = center;
  const latest = useRef({ onResults, t, tp, locale });
  latest.current = { onResults, t, tp, locale };

  const categoryRef = useRef(category);
  const qRef = useRef(q);
  const withDataRef = useRef(withData);
  categoryRef.current = category;
  qRef.current = q;
  withDataRef.current = withData;
  const ask = useCallback((reason: Request['reason'], change: Partial<Pick<Request, 'scope' | 'area'>> = {}) => {
    setRequest(r => ({
      seq: (r?.seq ?? 0) + 1,
      category: categoryRef.current,
      q: qRef.current,
      withData: withDataRef.current,
      scope: change.scope ?? r?.scope ?? 'view',
      area: change.area !== undefined ? change.area : latestView.current,
      origin: centerRef.current,
      reason,
    }));
  }, []);

  // An explicit search (text, category, "with facts"): first page now, short pause while typing.
  const asked = useRef(false);
  useEffect(() => {
    const initial = !asked.current;
    const timer = setTimeout(() => {
      asked.current = true;
      ask(initial ? 'initial' : 'search');
    }, initial ? 0 : 200);
    return () => clearTimeout(timer);
  }, [category, q, withData, ask]);

  // The map moved: follow the visible area once it settles. The app's own camera moves only update the area used next.
  const viewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!viewport) return;
    const previous = latestView.current;
    const area: Area = { bbox: viewport.bbox, center: viewport.center, zoom: viewport.zoom };
    latestView.current = area;
    // The map loaded after the list asked for the first page: ask again for what is actually visible.
    if (!previous && asked.current) {
      ask('initial', { area });
      return;
    }
    if (!viewport.user || !moved(previous, area)) return;
    clearTimeout(viewTimer.current);
    viewTimer.current = setTimeout(() => ask('view', { scope: 'view', area }), VIEW_DEBOUNCE_MS);
  }, [viewport, ask]);
  useEffect(() => () => clearTimeout(viewTimer.current), []);

  const commit = useCallback((next: List | null) => {
    listRef.current = next;
    setList(next);
  }, []);

  // First page for each request. Earlier requests and their "more" pages are cancelled; the current list stays
  // on screen (dimmed, with a thin progress bar) until the new one replaces it in place.
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    generation.current++;
    moreController.current?.abort();
    moreBusy.current = false;
    moreFailed.current = false;
    firstBusy.current = true;
    setMore('idle');
    setFirst({ loading: true, error: '' });
    if (request.reason !== 'view') setAnnouncement(latest.current.t('explore.loading'));
    fetchPage(request, 0, locale, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        const before = listRef.current?.objects.slice(0, data.objects.length).map(o => o.id).join();
        const changed = before !== data.objects.map(o => o.id).join();
        firstBusy.current = false;
        commit({ request, objects: data.objects, total: data.total ?? data.objects.length, next: data.nextOffset ?? null, outside: data.outside ?? 0 });
        setFirst({ loading: false, error: '' });
        // Places found in the visible area are already in view; only a search beyond it moves the map to them.
        latest.current.onResults(data.objects, request.reason === 'search' && (request.scope === 'city' || !request.area));
        const { t: tr, tp: tpr } = latest.current;
        const count = tpr('explore.count', data.total ?? data.objects.length);
        setAnnouncement(request.reason === 'view' ? tr('explore.updated', { count }) : count);
        // A different set starts from its top; the same set keeps the reading position.
        const root = scrollRoot.current;
        const top = section.current && root ? section.current.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 8 : 0;
        if (changed && root && root.scrollTop > top) root.scrollTo({ top });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        firstBusy.current = false;
        setFirst({ loading: false, error: latest.current.t('explore.failed') });
        setAnnouncement(latest.current.t('explore.failed'));
      });
    return () => controller.abort();
  }, [request, locale, commit]);

  // Leaving the tab clears the places from the map.
  useEffect(() => () => latest.current.onResults([], false), []);

  const loadMore = useCallback(() => {
    const current = listRef.current;
    if (!current || current.next === null || moreBusy.current || firstBusy.current || moreFailed.current) return;
    moreBusy.current = true;
    setMore('loading');
    const controller = new AbortController();
    moreController.current = controller;
    const gen = generation.current;
    fetchPage(current.request, current.next, latest.current.locale, controller.signal)
      .then(data => {
        if (gen !== generation.current || controller.signal.aborted) return;
        const seen = new Set(current.objects.map(o => o.id));
        const objects = [...current.objects, ...data.objects.filter(o => !seen.has(o.id))];
        moreBusy.current = false;
        commit({ ...current, objects, total: data.total ?? current.total, next: data.nextOffset ?? null });
        setMore('idle');
        latest.current.onResults(objects, false);
      })
      .catch(() => {
        if (gen !== generation.current || controller.signal.aborted) return;
        // Keep the cursor so "try again" continues where it stopped.
        moreBusy.current = false;
        moreFailed.current = true;
        setMore('error');
      });
  }, [commit]);

  const nearEnd = useCallback(() => {
    const el = sentinel.current;
    if (!el) return false;
    const bottom = scrollRoot.current ? scrollRoot.current.getBoundingClientRect().bottom : window.innerHeight;
    return el.getBoundingClientRect().top - bottom < PREFETCH_PX;
  }, []);

  // Infinite scroll: prefetch while the end of the list is still well below the fold.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    scrollRoot.current = scrollParent(section.current);
    const io = new IntersectionObserver(entries => entries[0]?.isIntersecting && loadMore(), {
      root: scrollRoot.current,
      rootMargin: `0px 0px ${PREFETCH_PX}px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);
  // After each page: if the end is still near (fast scrolling, tall screens), keep going.
  useEffect(() => {
    if (more === 'idle' && !first.loading && list?.next != null && nearEnd()) loadMore();
  }, [list, more, first.loading, nearEnd, loadMore]);

  const retryMore = () => {
    moreFailed.current = false;
    setMore('idle');
    loadMore();
  };
  const refreshing = first.loading && !!list;
  const inArea = list?.request.scope === 'view' && !!list.request.area;

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

      <section ref={section} aria-labelledby="explore-results" aria-busy={first.loading} className="relative flex flex-col gap-3">
        {/* Thin progress bar while a new area or search loads; takes no space, so nothing jumps. */}
        <div className="sticky top-0 z-10 h-0" aria-hidden>
          {refreshing ? (
            <div className="absolute inset-x-0 -top-2 h-1 overflow-hidden rounded-full bg-primary/15">
              <div className="explore-progress h-full w-1/3 rounded-full bg-primary" />
            </div>
          ) : null}
        </div>
        <div className="px-1">
          <h2 id="explore-results" className="text-lg font-bold">
            {list ? tp('explore.count', list.total) : first.loading ? t('explore.loading') : tp('explore.count', 0)}
          </h2>
          {list ? <p className="text-sm text-muted-foreground">{inArea ? t('explore.inView') : t('explore.inCity')}</p> : null}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
        {first.error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
            <p className="font-medium">{first.error}</p>
            <Button variant="outline" className="h-11" onClick={() => setRequest(r => (r ? { ...r, seq: r.seq + 1 } : r))}>
              {t('results.retry')}
            </Button>
          </div>
        ) : null}
        {!list ? (
          first.loading ? [0, 1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />) : null
        ) : !list.objects.length ? (
          inArea ? (
            <div className={cn('flex flex-col items-start gap-3 rounded-xl border bg-card p-4', refreshing && 'opacity-60')}>
              <p className="font-medium">{t('explore.noneInView')}</p>
              {list.outside > 0 ? (
                <Button variant="secondary" className="h-11" onClick={() => ask('search', { scope: 'city' })} disabled={first.loading}>
                  <Search />
                  {t('explore.searchCity')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className={cn('rounded-xl border bg-card p-4 text-muted-foreground', refreshing && 'opacity-60')}>{t('explore.empty')}</p>
          )
        ) : (
          <ul className={cn('flex flex-col gap-2 transition-opacity', refreshing && 'opacity-60')}>
            {list.objects.map(o => (
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
        {more === 'loading' ? (
          <>
            <p className="sr-only">{t('explore.loadingMore')}</p>
            {[0, 1].map(i => <Skeleton key={i} className="h-24 rounded-xl" aria-hidden />)}
          </>
        ) : more === 'error' ? (
          <div className="flex flex-wrap items-center gap-3 px-1">
            <p className="text-sm font-medium">{t('explore.failed')}</p>
            <Button variant="outline" className="h-11" onClick={retryMore}>
              {t('results.retry')}
            </Button>
          </div>
        ) : list && list.objects.length && list.next === null && !refreshing ? (
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
