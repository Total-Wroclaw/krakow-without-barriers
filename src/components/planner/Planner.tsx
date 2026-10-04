'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDownUp, Compass, Info, Footprints, MapPin, Navigation, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CityFact, CityPlace } from '@/lib/city-types';
import type { MapViewport, PlaceObject, PlaceObjectSummary } from '@/lib/explore-types';
import { errorText, postJson } from '@/lib/client';
import { warsawNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { JourneyResult, TransportMode } from '@/lib/journey-types';
import { defaultPreferences, preferencesSchema, type Preferences, type Report } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { nearRoute } from '@/lib/route-proximity';
import { decodePlace, readDeparture, writeTrip, type When } from '@/lib/trip-sharing';
import { About } from './About';
import { Explore } from './Explore';
import { FactSheet } from './FactSheet';
import { LanguageMenu } from './LanguageMenu';
import { ObjectSheet } from './ObjectSheet';
import { OptionCard } from './OptionCard';
import { PartnerForm } from './PartnerForm';
import { PlaceInput } from './PlaceInput';
import { DistanceControl, PreferencesBar, PreferencesPanel } from './Preferences';
import { ReportChooser } from './ReportChooser';
import { RouteDetails } from './RouteDetails';
import { ReportFab, ReportPanel, useReportCapture, type CaptureTarget } from './Reports';
import { TimeChooser } from './TimeChooser';
import { TransportPicker } from './TransportPicker';
import { useBottomSheet } from './useBottomSheet';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-muted" aria-hidden />,
});

const PREFS_KEY = 'krok-preferences-v1';
/** How the person travels, for the place card's way-in advice (same key in AerialSection). */
const TRANSPORT_KEY = 'krok-transport';
const EXAMPLE: { from: CityPlace; to: CityPlace } = {
  from: { id: 'example:dworzec', name: 'Dworzec Główny', lat: 50.06583, lon: 19.94756, source: 'example' },
  to: { id: 'example:wawel', name: 'Wawel, Smok Wawelski', lat: 50.05302, lon: 19.93359, source: 'example' },
};

function loadPreferences(): Preferences | null {
  try {
    // Older saved settings lack newer fields; fill them from defaults.
    const saved = preferencesSchema.safeParse({ ...defaultPreferences, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') });
    return saved.success ? saved.data : null;
  } catch {
    return null;
  }
}

/** The whole app. `embed` turns it into a "how to reach us" widget with a fixed destination. */
export default function Planner({ embed }: { embed?: CityPlace }) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'route' | 'explore'>('route');
  const [from, setFrom] = useState<CityPlace | null>(null);
  const [to, setTo] = useState<CityPlace | null>(embed ?? null);
  const [when, setWhen] = useState<When>({ mode: 'now' });
  const [transport, setTransport] = useState<TransportMode>('transit');
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [fact, setFact] = useState<CityFact | null>(null);
  const [openReport, setOpenReport] = useState<{ report: Report; editing: boolean | 'place' } | null>(null);
  const [objects, setObjects] = useState<PlaceObjectSummary[]>([]);
  const [objectId, setObjectId] = useState<string | null>(null);
  // Explore follows the map: the visible area, and a key that changes only when the list asks the map to fit its places.
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  const [objectsFit, setObjectsFit] = useState(0);
  const onExploreResults = useCallback((next: PlaceObjectSummary[], fit: boolean) => {
    setObjects(next);
    if (fit) setObjectsFit(n => n + 1);
  }, []);
  const [partner, setPartner] = useState<{ open: boolean; existing: PlaceObject | null }>({ open: false, existing: null });
  const [hydrated, setHydrated] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [retry, setRetry] = useState(0);
  const [searching, setSearching] = useState<Record<string, boolean>>({});
  const searchActive = Object.values(searching).some(Boolean);
  const onFromActive = useCallback((v: boolean) => setSearching(s => ({ ...s, from: v })), []);
  const onToActive = useCallback((v: boolean) => setSearching(s => ({ ...s, to: v })), []);
  const mapCenter = useRef({ lat: 50.061, lon: 19.945 });
  const scroller = useRef<HTMLDivElement>(null);
  // Phones: the panel is a sheet over the map; typing a place opens it fully for the suggestions.
  const tabsRef = useRef<HTMLDivElement>(null);
  const sheet = useBottomSheet(scroller, searchActive ? 'full' : undefined, tabsRef);
  // Collapsed, the sheet shows the tabs: tapping one opens it.
  const openSheet = () => sheet.snap === 'peek' && sheet.setSnap('half');
  const mobileView = sheet.snap === 'peek' ? 'map' : 'list';
  const setMobileView = (view: 'map' | 'list') => sheet.setSnap(view === 'map' ? 'peek' : 'half');
  const listScroll = useRef(0);
  const listOpener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const saved = loadPreferences();
    if (saved) setPreferences(saved);
    // Shared endpoints, transport and departure open the same trip; needs stay the recipient's own.
    if (!embed) {
      const params = new URLSearchParams(window.location.search);
      const sharedFrom = decodePlace(params.get('from'));
      const sharedTo = decodePlace(params.get('to'));
      if (sharedFrom) setFrom(sharedFrom);
      if (sharedTo) setTo(sharedTo);
      setWhen(readDeparture(params));
      const mode = params.get('mode');
      if (mode === 'walk' || mode === 'taxi' || mode === 'car' || mode === 'transit') setTransport(mode);
    }
    setHydrated(true);
    fetch('/api/reports')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setReports(d.reports))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  }, [preferences, hydrated]);

  // Plan as soon as both ends are known; re-plan when needs, transport, language or time change.
  useEffect(() => {
    if (!from || !to || !hydrated) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      const now = warsawNow();
      const date = when.mode === 'now' ? now.date : when.date;
      const time = when.mode === 'now' ? now.time : when.time;
      try {
        const data = await postJson('/api/journey', { from, to, preferences, date, time, transport, locale }, 35000, {}, controller.signal);
        if (controller.signal.aborted) return;
        const next = data as JourneyResult;
        setResult(next);
        setSelectedId(current => (next.options.some(o => o.id === current) ? current : (next.options.find(o => o.fits) ?? next.options[0])?.id ?? null));
      } catch (e) {
        if (!controller.signal.aborted) {
          setResult(null);
          setError(errorText(e, t('results.failed')));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [from, to, preferences, when, transport, locale, hydrated, retry, t]);

  const options = result?.options ?? [];
  const selected = options.find(o => o.id === selectedId);
  const routeReports = useMemo(() => reports.filter(r => nearRoute(r, selected)), [reports, selected]);

  const fallback = useCallback((): CaptureTarget => {
    if (fact) return { place: { id: `point:${fact.lat}:${fact.lon}`, name: fact.title, lat: fact.lat, lon: fact.lon, source: fact.sourceUrl }, source: 'fact', factId: fact.id };
    const c = mapCenter.current;
    return { place: { id: `point:${c.lat}:${c.lon}`, name: t('report.mapPoint'), lat: c.lat, lon: c.lon, source: 'map' }, source: 'map' };
  }, [fact, t]);
  const onSaved = useCallback((r: Report) => setReports(old => [r, ...old.filter(existing => existing.id !== r.id)]), []);
  const onOpen = useCallback((report: Report, editing: boolean | 'place') => setOpenReport({ report, editing }), []);
  const { capture, busy, notice: photoNotice } = useReportCapture({ fallback, onSaved, onOpen });

  // What "selected place" means for a report: an open barrier, an open place card, or the trip destination.
  const reportTarget = useMemo((): CaptureTarget | null => {
    if (fact) return { place: { id: `point:${fact.lat}:${fact.lon}`, name: fact.title, lat: fact.lat, lon: fact.lon, source: fact.sourceUrl }, source: 'fact', factId: fact.id };
    const o = objectId ? objects.find(x => x.id === objectId) : undefined;
    if (o) return { place: { id: `point:${o.lat}:${o.lon}`, name: o.name, lat: o.lat, lon: o.lon, source: 'object' }, source: 'fact', factId: o.id };
    if (to) return { place: { ...to, id: `point:${to.lat}:${to.lon}` }, source: 'fact' };
    return null;
  }, [fact, objectId, objects, to]);
  const mapPoint = useCallback((): CaptureTarget => {
    const c = mapCenter.current;
    return { place: { id: `point:${c.lat}:${c.lon}`, name: t('report.mapPoint'), lat: c.lat, lon: c.lon, source: 'map' }, source: 'map' };
  }, [t]);

  // Toilets come from the Explore index; open their place card instead of a map fact.
  const openFact = useCallback((f: CityFact) => (f.kind === 'toilet' && f.objectId ? setObjectId(f.objectId) : setFact(f)), []);

  function choose(id: string) {
    setSelectedId(id);
    if (!detail) {
      // Remember where the list was left; going back restores both.
      listScroll.current = scroller.current?.scrollTop ?? 0;
      listOpener.current = document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-option]') ? document.activeElement : null;
    }
    // A history entry for the detail view, so the phone's Back gesture returns to the list instead of leaving.
    if (!detail && !embed) window.history.pushState({ krokDetail: true }, '', window.location.href);
    setDetail(true);
  }

  function closeDetail() {
    if (window.history.state?.krokDetail) window.history.back();
    else setDetail(false);
    if (sheet.snap === 'peek') sheet.setSnap('half');
  }

  useEffect(() => {
    const onPop = (e: PopStateEvent) => setDetail(!!e.state?.krokDetail);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Keep the trip in the URL so refresh and shared links restore it.
  useEffect(() => {
    if (!hydrated || embed) return;
    const url = new URL(window.location.href);
    writeTrip(url.searchParams, { from, to, transport, when });
    window.history.replaceState(window.history.state, '', url);
  }, [from, to, transport, when, hydrated, embed]);

  // The place card's way-in advice starts from a stop, or from a car park when the person drives.
  useEffect(() => {
    try {
      sessionStorage.setItem(TRANSPORT_KEY, transport);
    } catch {}
  }, [transport]);

  // A different way of travelling means a different best option; don't keep a stale selection.
  const firstTransport = useRef(true);
  useEffect(() => {
    if (firstTransport.current) {
      firstTransport.current = false;
      return;
    }
    setSelectedId(null);
    setDetail(false);
  }, [transport]);

  // Details start at the top; back on the list, the scroll position and focus are where they were left.
  // Focus moves with the view so keyboard and screen-reader users land in the new content.
  const showDetail = detail && !!selected;
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const resultsTitle = useRef<HTMLHeadingElement>(null);
  const wasDetail = useRef(false);
  const [returned, setReturned] = useState(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (showDetail) {
      if (el) el.scrollTop = 0;
      detailHeading.current?.focus({ preventScroll: true });
    } else if (wasDetail.current) {
      if (el) el.scrollTop = listScroll.current;
      const opener = listOpener.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else resultsTitle.current?.focus({ preventScroll: true });
      setReturned(true);
    }
    wasDetail.current = showDetail;
  }, [showDetail]);

  async function share() {
    if (!from || !to) return;
    const url = new URL(window.location.origin);
    writeTrip(url.searchParams, { from, to, transport, when });
    const text = t('share.text', { from: from.name, to: to.name });
    try {
      if (navigator.share) await navigator.share({ title: t('app.name'), text, url: url.toString() });
      else {
        await navigator.clipboard.writeText(url.toString());
        toast.success(t('share.copied'));
      }
    } catch {}
  }

  /** "Set as start / destination" from a tap on the map: the same as choosing a search suggestion. */
  const pickOnMap = useCallback(
    (role: 'from' | 'to', place: CityPlace) => {
      if (role === 'from') setFrom(place);
      else setTo(place);
      // New ends mean new options; show them in the list rather than a route that is about to change.
      if (detail) closeDetail();
    },
    // closeDetail only reads history and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail],
  );

  function routeTo(o: PlaceObject) {
    setTo({ id: o.id, name: o.name, lat: o.lat, lon: o.lon, source: 'object' });
    setObjectId(null);
    setDetail(false);
    setTab('route');
  }

  const exploring = tab === 'explore' && !embed;

  return (
    <div className="app-shell relative flex h-svh flex-col overflow-clip lg:flex-row">
      <a href="#planner" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {t('app.skip')}
      </a>

      <main
        id="planner"
        // The skip link's target: focusable so every browser and screen reader really moves there.
        tabIndex={-1}
        className={cn(
          'order-2 flex outline-none min-h-0 flex-1 flex-col border-border bg-background lg:order-1 lg:w-[440px] lg:flex-none lg:border-r',
          'max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:h-[var(--sheet,50svh)] max-lg:flex-none max-lg:rounded-t-[1.75rem] max-lg:border-t max-lg:shadow-[0_-8px_32px_rgb(15_23_42/0.16)]',
          !sheet.dragging && 'max-lg:transition-[height] max-lg:duration-300 max-lg:ease-out motion-reduce:transition-none',
        )}
        style={sheet.height !== null ? ({ '--sheet': `${sheet.height}px` } as CSSProperties) : undefined}
      >
        <div className="flex shrink-0 justify-center lg:hidden">
          <button
            type="button"
            {...sheet.handle}
            aria-label={t(sheet.snap === 'full' ? 'sheet.collapse' : 'sheet.expand')}
            className="grid h-7 w-full touch-none cursor-grab place-items-center active:cursor-grabbing"
          >
            <span aria-hidden className="h-1.5 w-11 rounded-full bg-muted-foreground/35" />
          </button>
        </div>
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-1 lg:pt-5">
            {embed ? (
              <p className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <MapPin className="size-5 text-primary" aria-hidden />
                {t('embed.title')}
              </p>
            ) : (
              <a href="/" className="flex min-w-0 items-center gap-2 whitespace-nowrap text-lg font-bold tracking-tight">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
                  <Footprints className="size-5" />
                </span>
                {t('app.name')}
              </a>
            )}
            <div className="flex shrink-0 items-center">
              <LanguageMenu />
              {!embed ? <About /> : null}
            </div>
          </header>

          <Tabs value={embed ? 'route' : tab} onValueChange={v => setTab(v as 'route' | 'explore')} className="gap-0">
          {!embed && !showDetail ? (
            <div className="px-4 pb-3">
              <TabsList ref={tabsRef} className="grid h-12! w-full grid-cols-2 gap-1 p-1" aria-label={t('tabs.label')}>
                <TabsTrigger value="route" onClick={openSheet} className="h-10! min-w-0 gap-1.5 text-base text-muted-foreground data-[state=active]:text-foreground">
                  <Navigation aria-hidden />
                  {t('tabs.route')}
                </TabsTrigger>
                <TabsTrigger value="explore" onClick={openSheet} className="h-10! min-w-0 gap-1.5 text-base text-muted-foreground data-[state=active]:text-foreground">
                  <Compass aria-hidden />
                  {t('tabs.explore')}
                </TabsTrigger>
              </TabsList>
            </div>
          ) : null}
          <TabsContent value="explore" tabIndex={-1}>
            {exploring ? <Explore center={from ?? mapCenter.current} viewport={viewport} selectedId={objectId} onResults={onExploreResults} onSelect={setObjectId} onOwner={() => setPartner({ open: true, existing: null })} /> : null}
          </TabsContent>
          <TabsContent value="route" tabIndex={-1}>
          {/* The list stays mounted (hidden) under the details view, keeping its scroll position, inputs and focus target. */}
            <div hidden={showDetail} className={cn('flex flex-col gap-4 px-4 pb-10', returned && 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200')}>
              <h1 className="sr-only">{embed ? t('embed.title') : t('home.h1')}</h1>
              <section className="rounded-2xl border bg-card p-1.5 shadow-sm" aria-label={t('search.region')}>
                <div className="relative">
                  <div className={searchActive ? undefined : 'pr-12'}>
                    <PlaceInput label={t('search.from')} placeholder={embed ? t('embed.from') : t('search.fromPlaceholder')} value={from} onChange={setFrom} marker="start" near={to} onError={m => toast.error(m)} onActiveChange={onFromActive} />
                  </div>
                  <div className="ml-12 mr-14 border-t" />
                  <div className={searchActive ? undefined : 'pr-12'}>
                    {embed ? (
                      <p className="flex min-h-12 items-center gap-3 px-3">
                        <span aria-hidden className="size-3 shrink-0 rounded-full border-[3px] border-primary bg-primary" />
                        <span className="w-12 shrink-0 text-sm text-muted-foreground">{t('search.to')}</span>
                        <span className="font-medium">{embed.name}</span>
                      </p>
                    ) : (
                      <PlaceInput label={t('search.to')} placeholder={t('search.toPlaceholder')} value={to} onChange={setTo} marker="end" near={from} onError={m => toast.error(m)} onActiveChange={onToActive} />
                    )}
                  </div>
                  {!embed ? (
                    <Button variant="outline" size="icon" onClick={() => { setFrom(to); setTo(from); }} hidden={searchActive} className="absolute right-1.5 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full bg-card" aria-label={t('search.swap')}>
                      <ArrowDownUp />
                    </Button>
                  ) : null}
                </div>
                <div className="mt-1 border-t px-1 pt-1.5">
                  <TransportPicker value={transport} onChange={setTransport} />
                </div>
                <div className="mt-1 border-t">
                  <DistanceControl preferences={preferences} onChange={setPreferences} />
                </div>
                <div className="border-t py-1">
                  <TimeChooser value={when} onChange={setWhen} />
                </div>
                <div className="border-t pt-1">
                  <PreferencesBar preferences={preferences} onOpen={() => setPrefsOpen(true)} />
                </div>
              </section>

              {!from || !to ? (
                !embed ? (
                  <section className="flex flex-col gap-3 px-1 pt-2">
                    <h2 className="text-2xl font-bold tracking-tight">{t('home.title')}</h2>
                    <p className="text-muted-foreground">{t('home.body')}</p>
                    <Button variant="secondary" className="h-11 self-start" onClick={() => { setFrom(EXAMPLE.from); setTo(EXAMPLE.to); }}>
                      {t('home.example')}
                    </Button>
                  </section>
                ) : null
              ) : (
                <section aria-labelledby="results-title" aria-busy={loading} className="flex flex-col gap-3">
                  <h2 id="results-title" ref={resultsTitle} tabIndex={-1} className="px-1 text-lg font-bold outline-none">
                    {loading ? t('results.searching') : options.length ? t('results.title', { n: options.length }) : t('results.titleEmpty')}
                  </h2>
                  <p className="sr-only" role="status">{loading ? t('results.searching') : options.length ? t('results.found', { n: options.length }) : ''}</p>
                  {loading && !options.length ? (
                    [0, 1, 2].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)
                  ) : error ? (
                    <div className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
                      <p className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />{error}</p>
                      <Button variant="outline" className="h-11" onClick={() => setRetry(n => n + 1)}><RefreshCw />{t('results.retry')}</Button>
                    </div>
                  ) : (
                    <>
                      {result?.errors.map(e => (
                        <p key={e} className="flex items-start gap-2 rounded-lg bg-muted/70 px-3 py-2 text-sm"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{e}</p>
                      ))}
                      <ul className={cn('flex flex-col gap-3', loading && 'opacity-60')}>
                        {options.map(o => (
                          <li key={o.id} data-option={o.id}>
                            <OptionCard option={o} selected={o.id === selectedId} onOpen={() => choose(o.id)} onPick={() => setSelectedId(o.id)} />
                          </li>
                        ))}
                      </ul>
                      {!options.length && !loading ? (
                        <div className="rounded-xl border bg-card p-4">
                          <p className="font-semibold">{t('results.none')}</p>
                          <p className="text-muted-foreground">{t('results.noneHint')}</p>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              )}
            </div>
          {showDetail && selected ? (
            <RouteDetails
              option={selected}
              to={to}
              reports={routeReports}
              mobileView={mobileView}
              onMobileView={setMobileView}
              onBack={closeDetail}
              onShare={embed ? undefined : share}
              onFact={openFact}
              onReport={r => setOpenReport({ report: r, editing: false })}
              headingRef={detailHeading}
            />
          ) : null}
          </TabsContent>
          </Tabs>
          {embed ? <p className="px-4 pb-6 text-center text-xs text-muted-foreground"><a href="/" target="_blank" rel="noreferrer" className="underline">{t('embed.powered')}</a></p> : null}
        </div>
      </main>

      <div
        className={cn(
          'order-1 max-lg:absolute max-lg:inset-0 lg:relative lg:order-2 lg:flex-1',
        )}
      >
        <MapView
          options={exploring ? [] : options}
          selectedId={exploring ? null : selectedId}
          detail={!exploring && detail}
          focus={fact}
          from={exploring ? null : from}
          to={exploring ? null : to}
          reports={exploring ? [] : routeReports}
          objects={exploring ? objects : []}
          selectedObjectId={objectId}
          onSelect={choose}
          onFact={openFact}
          onReport={r => setOpenReport({ report: r, editing: false })}
          onObject={setObjectId}
          onMove={c => (mapCenter.current = c)}
          onViewportChange={setViewport}
          objectsFitKey={exploring ? objectsFit : undefined}
          onPick={exploring ? undefined : pickOnMap}
          pickRoles={embed ? ['from'] : undefined}
          bottomInset={sheet.mobile && sheet.height ? Math.min(sheet.height, Math.round(window.innerHeight * 0.6)) : 0}
        />
        {!embed ? (
          <div className="absolute left-3 top-3 z-10 lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))] lg:left-4 lg:top-auto">
            <ReportFab busy={busy} onClick={() => setChooser(true)} />
          </div>
        ) : null}
      </div>


      {photoNotice}
      <PreferencesPanel open={prefsOpen} onOpenChange={setPrefsOpen} preferences={preferences} onChange={setPreferences} />
      <FactSheet
        fact={fact}
        reports={reports}
        onClose={() => setFact(null)}
        onReport={f => capture({ place: { id: `point:${f.lat}:${f.lon}`, name: f.title, lat: f.lat, lon: f.lon, source: f.sourceUrl }, source: 'fact', factId: f.id })}
        onOpenReport={r => setOpenReport({ report: r, editing: false })}
      />
      <ObjectSheet
        id={objectId}
        onClose={() => setObjectId(null)}
        onRoute={routeTo}
        onPhoto={o => capture({ place: { id: `point:${o.lat}:${o.lon}`, name: o.name, lat: o.lat, lon: o.lon, source: 'object' }, source: 'fact', factId: o.id })}
        onOwner={o => {
          setObjectId(null);
          setPartner({ open: true, existing: o });
        }}
      />
      <ReportChooser
        open={chooser}
        onOpenChange={setChooser}
        onPhoto={() => capture(fact || objectId ? (reportTarget ?? undefined) : undefined)}
        selected={reportTarget}
        mapPoint={mapPoint}
        destination={to?.name}
        onSaved={onSaved}
      />
      <PartnerForm open={partner.open} existing={partner.existing} onClose={() => setPartner({ open: false, existing: null })} />
      {openReport ? (
        <ReportPanel
          report={openReport.report}
          editing={openReport.editing}
          onClose={() => setOpenReport(null)}
          onChange={r => {
            setReports(old => old.map(x => (x.id === r.id ? r : x)));
            setOpenReport({ report: r, editing: false });
          }}
          onDelete={id => {
            setReports(old => old.filter(x => x.id !== id));
            setOpenReport(null);
          }}
        />
      ) : null}
    </div>
  );
}
