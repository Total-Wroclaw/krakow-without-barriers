'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ArrowDownUp, ArrowLeft, Clock, Compass, Info, Footprints, List, Map as MapIcon, MapPin, Navigation, RefreshCw, Share2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CityFact, CityPlace } from '@/lib/city-types';
import type { PlaceObject, PlaceObjectSummary } from '@/lib/explore-types';
import { errorText } from '@/lib/client';
import { warsawNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { JourneyOption, JourneyResult, TransportMode } from '@/lib/journey-types';
import { defaultPreferences, preferencesSchema, type Preferences, type Report } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { About } from './About';
import { Explore } from './Explore';
import { FactSheet } from './FactSheet';
import { JourneyDetail } from './JourneyDetail';
import { LanguageMenu } from './LanguageMenu';
import { ObjectSheet } from './ObjectSheet';
import { OptionCard } from './OptionCard';
import { PartnerForm } from './PartnerForm';
import { PlaceInput } from './PlaceInput';
import { DistanceControl, PreferencesBar, PreferencesPanel } from './Preferences';
import { ReportChooser } from './ReportChooser';
import { ReportFab, ReportPanel, useReportCapture, type CaptureTarget } from './Reports';
import { TimeChooser, type When } from './TimeChooser';
import { TransportPicker } from './TransportPicker';

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-muted" aria-hidden />,
});

const PREFS_KEY = 'krok-preferences-v1';
const EXAMPLE: { from: CityPlace; to: CityPlace } = {
  from: { id: 'example:dworzec', name: 'Dworzec Główny', lat: 50.06583, lon: 19.94756, source: 'example' },
  to: { id: 'example:wawel', name: 'Wawel, Smok Wawelski', lat: 50.05302, lon: 19.93359, source: 'example' },
};

function nearRoute(report: Report, option: JourneyOption | undefined) {
  if (!option || !report.location) return false;
  const { lat, lon } = report.location;
  const k = Math.cos((lat * Math.PI) / 180);
  return option.legs.some(leg => leg.type === 'walk' && leg.geometry.some(([a, b]) => Math.hypot((a - lat) * 111_000, (b - lon) * 111_000 * k) < 40));
}

const encodePlace = (p: CityPlace) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.name}`;
function decodePlace(value: string | null): CityPlace | null {
  if (!value) return null;
  const [lat, lon, ...name] = value.split(',');
  const place = { id: `point:${lat}:${lon}`, name: name.join(',') || '—', lat: Number(lat), lon: Number(lon), source: 'link' };
  return Number.isFinite(place.lat) && Number.isFinite(place.lon) && place.lat > 49.94 && place.lat < 50.2 && place.lon > 19.75 && place.lon < 20.25 ? place : null;
}

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
  const [mobileView, setMobileView] = useState<'map' | 'list'>('list');
  const [reports, setReports] = useState<Report[]>([]);
  const [fact, setFact] = useState<CityFact | null>(null);
  const [openReport, setOpenReport] = useState<{ report: Report; editing: boolean } | null>(null);
  const [objects, setObjects] = useState<PlaceObjectSummary[]>([]);
  const [objectId, setObjectId] = useState<string | null>(null);
  const [partner, setPartner] = useState<{ open: boolean; existing: PlaceObject | null }>({ open: false, existing: null });
  const [hydrated, setHydrated] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [retry, setRetry] = useState(0);
  const [searching, setSearching] = useState<Record<string, boolean>>({});
  const searchActive = Object.values(searching).some(Boolean);
  const onFromActive = useCallback((v: boolean) => setSearching(s => ({ ...s, from: v })), []);
  const onToActive = useCallback((v: boolean) => setSearching(s => ({ ...s, to: v })), []);
  const mapCenter = useRef({ lat: 50.061, lon: 19.945 });

  useEffect(() => {
    const saved = loadPreferences();
    if (saved) setPreferences(saved);
    // A shared link (?from=lat,lon,name&to=…&mode=…) opens the same trip; needs stay the recipient's own.
    if (!embed) {
      const params = new URLSearchParams(window.location.search);
      const sharedFrom = decodePlace(params.get('from'));
      const sharedTo = decodePlace(params.get('to'));
      if (sharedFrom) setFrom(sharedFrom);
      if (sharedTo) setTo(sharedTo);
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
        const res = await fetch('/api/journey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, preferences, date, time, transport, locale }),
          signal: controller.signal,
        });
        // Proxies may answer with HTML (e.g. 502); never show parser errors to people.
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(typeof data?.error === 'string' ? data.error : '');
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
  const onSaved = useCallback((r: Report) => setReports(old => [r, ...old]), []);
  const onOpen = useCallback((report: Report, editing: boolean) => setOpenReport({ report, editing }), []);
  const { capture, busy } = useReportCapture({ fallback, onSaved, onOpen });

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
    // A history entry for the detail view, so the phone's Back gesture returns to the list instead of leaving.
    if (!detail && !embed) window.history.pushState({ krokDetail: true }, '', window.location.href);
    setDetail(true);
  }

  function closeDetail() {
    if (window.history.state?.krokDetail) window.history.back();
    else setDetail(false);
    setMobileView('list');
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
    for (const key of ['from', 'to', 'mode']) url.searchParams.delete(key);
    if (from) url.searchParams.set('from', encodePlace(from));
    if (to) url.searchParams.set('to', encodePlace(to));
    if (transport !== 'transit') url.searchParams.set('mode', transport);
    window.history.replaceState(window.history.state, '', url);
  }, [from, to, transport, hydrated, embed]);

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

  // Move focus with the view so keyboard and screen-reader users land in the new content.
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const resultsTitle = useRef<HTMLHeadingElement>(null);
  const wasDetail = useRef(false);
  useEffect(() => {
    if (detail) detailHeading.current?.focus({ preventScroll: true });
    else if (wasDetail.current) resultsTitle.current?.focus({ preventScroll: true });
    wasDetail.current = detail;
  }, [detail]);

  async function share() {
    if (!from || !to) return;
    const url = new URL(window.location.origin);
    url.searchParams.set('from', encodePlace(from));
    url.searchParams.set('to', encodePlace(to));
    url.searchParams.set('mode', transport);
    const text = t('share.text', { from: from.name, to: to.name });
    try {
      if (navigator.share) await navigator.share({ title: t('app.name'), text, url: url.toString() });
      else {
        await navigator.clipboard.writeText(url.toString());
        toast.success(t('share.copied'));
      }
    } catch {}
  }

  function routeTo(o: PlaceObject) {
    setTo({ id: o.id, name: o.name, lat: o.lat, lon: o.lon, source: 'object' });
    setObjectId(null);
    setDetail(false);
    setTab('route');
  }

  const showMapOnMobile = detail && mobileView === 'map';
  const exploring = tab === 'explore' && !embed;

  return (
    <div className="app-shell relative flex h-svh flex-col overflow-clip lg:flex-row">
      <a href="#planner" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {t('app.skip')}
      </a>

      <main id="planner" className="order-2 flex min-h-0 flex-1 flex-col border-border bg-background lg:order-1 lg:w-[440px] lg:flex-none lg:border-r">
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3 lg:pt-5">
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
          {!embed && !detail ? (
            <div className="px-4 pb-3">
              <TabsList className="grid h-12! w-full grid-cols-2 gap-1 p-1" aria-label={t('tabs.label')}>
                <TabsTrigger value="route" className="h-10! min-w-0 gap-1.5 text-base text-muted-foreground data-[state=active]:text-foreground">
                  <Navigation aria-hidden />
                  {t('tabs.route')}
                </TabsTrigger>
                <TabsTrigger value="explore" className="h-10! min-w-0 gap-1.5 text-base text-muted-foreground data-[state=active]:text-foreground">
                  <Compass aria-hidden />
                  {t('tabs.explore')}
                </TabsTrigger>
              </TabsList>
            </div>
          ) : null}
          <TabsContent value="explore" tabIndex={-1}>
            {exploring ? <Explore center={from ?? mapCenter.current} selectedId={objectId} onResults={setObjects} onSelect={setObjectId} onOwner={() => setPartner({ open: true, existing: null })} /> : null}
          </TabsContent>
          <TabsContent value="route" tabIndex={-1}>
          {!detail ? (
            <div className="flex flex-col gap-4 px-4 pb-10">
              <h1 className="sr-only">{embed ? t('embed.title') : t('home.h1')}</h1>
              <section className="rounded-2xl border bg-card p-1.5 shadow-sm" aria-label={t('search.region')}>
                <div className="relative">
                  <div className="pr-12">
                    <PlaceInput label={t('search.from')} placeholder={embed ? t('embed.from') : t('search.fromPlaceholder')} value={from} onChange={setFrom} marker="start" near={to} onError={m => toast.error(m)} onActiveChange={onFromActive} />
                  </div>
                  <div className="ml-12 mr-14 border-t" />
                  <div className="pr-12">
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
                <div className="mt-1 flex flex-wrap items-center gap-1 border-t px-1.5 pt-1">
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
                          <li key={o.id}>
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
          ) : selected ? (
            <div className="flex flex-col gap-4 px-4 pb-10">
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" className="-ml-2 h-11" onClick={closeDetail}>
                  <ArrowLeft />
                  {t('results.all')}
                </Button>
                <ToggleGroup type="single" value={mobileView} onValueChange={v => v && setMobileView(v as 'map' | 'list')} className="rounded-lg border bg-card p-0.5 lg:hidden" aria-label={t('results.view')}>
                  <ToggleGroupItem value="list" className="h-10 gap-1.5 px-3"><List />{t('results.list')}</ToggleGroupItem>
                  <ToggleGroupItem value="map" className="h-10 gap-1.5 px-3"><MapIcon />{t('results.map')}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <h1 ref={detailHeading} tabIndex={-1} className="sr-only">{t('results.detailH1')}</h1>
              <OptionCard option={selected} selected onOpen={() => setMobileView(v => (v === 'map' ? 'list' : 'map'))} />
              {selected.rideLinks?.length ? (
                <section className="flex flex-col gap-2" aria-labelledby="ride-apps">
                  <h2 id="ride-apps" className="px-1 text-sm font-semibold">{t('taxi.open')}</h2>
                  <div className="flex flex-wrap gap-2">
                    {selected.rideLinks.map(link => (
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
              {!embed ? (
                <Button variant="outline" className="h-11 self-start" onClick={share}>
                  <Share2 />
                  {t('share.button')}
                </Button>
              ) : null}
              <h2 className="px-1 text-lg font-bold">{t('results.steps')}</h2>
              <JourneyDetail option={selected} reports={routeReports} onFact={openFact} onReport={r => setOpenReport({ report: r, editing: false })} />
            </div>
          ) : null}
          </TabsContent>
          </Tabs>
          {embed ? <p className="px-4 pb-6 text-center text-xs text-muted-foreground"><a href="/" target="_blank" rel="noreferrer" className="underline">{t('embed.powered')}</a></p> : null}
        </div>
      </main>

      <div
        className={cn(
          'relative order-1 shrink-0 transition-[height] lg:order-2 lg:h-auto lg:flex-1',
          searchActive ? 'h-0 overflow-clip' : showMapOnMobile ? 'h-[68svh]' : detail ? 'h-[30svh]' : 'h-[34svh]',
        )}
      >
        <MapView
          options={exploring ? [] : options}
          selectedId={exploring ? null : selectedId}
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
        />
        {!embed ? (
          <div className="absolute left-3 top-3 z-10 lg:bottom-[max(1.5rem,env(safe-area-inset-bottom))] lg:left-4 lg:top-auto">
            <ReportFab busy={busy} onClick={() => setChooser(true)} />
          </div>
        ) : null}
      </div>


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
