'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Download, FilterX, Inbox, LogOut, MapPin, RefreshCw, Search, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cityStatusLabel, emptyCityFilter, filterReports, reportTypeLabel, summary, typeOf, type CityFilter } from '@/lib/city-reports';
import { cityStatuses, type Report } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import type { PartnerDeclaration } from '@/lib/objects';
import PartnerDeclarations from './PartnerDeclarations';
import ReportDetail from './ReportDetail';
import { formatDate, MapLinks, StatusBadge, TypeBadge } from './shared';

function Tile({ label, value, hint, onClick, pressed }: { label: string; value: number; hint: string; onClick: () => void; pressed: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        'flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        pressed && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

const plural = new Intl.PluralRules('pl-PL');
const countLabel = (n: number) => `${n} ${({ one: 'zgłoszenie', few: 'zgłoszenia' } as Record<string, string>)[plural.select(n)] ?? 'zgłoszeń'}`;
/** After "z" Polish needs the genitive: "z 1 zgłoszenia", "z 3 zgłoszeń". */
const ofCountLabel = (n: number) => `${n} ${n === 1 ? 'zgłoszenia' : 'zgłoszeń'}`;

function filterQuery(f: CityFilter) {
  const p = new URLSearchParams();
  if (f.status !== 'all') p.set('status', f.status);
  if (f.type !== 'all') p.set('type', f.type);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.q) p.set('q', f.q);
  return p.toString();
}

export default function CityDashboard({ initialReports, initialPartners }: { initialReports: Report[]; initialPartners: PartnerDeclaration[] }) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [filter, setFilter] = useState<CityFilter>(emptyCityFilter);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now] = useState(() => Date.now());

  const stats = useMemo(() => summary(reports, now), [reports, now]);
  const weekAgo = useMemo(() => new Date(now - 7 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }), [now]);
  const badRange = !!filter.from && !!filter.to && filter.from > filter.to;
  const visible = useMemo(() => (badRange ? [] : filterReports(reports, filter)), [reports, filter, badRange]);
  const open = reports.find(r => r.id === openId) ?? null;
  const filtered = filter.status !== 'all' || filter.type !== 'all' || !!filter.from || !!filter.to || !!filter.q;
  const set = (patch: Partial<CityFilter>) => setFilter(f => ({ ...f, ...patch }));

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch('/api/city/reports', { cache: 'no-store' });
      if (response.status === 401) return router.refresh();
      if (!response.ok) throw new Error();
      setReports(((await response.json()) as { reports: Report[] }).reports);
    } catch {
      toast.error('Nie udało się odświeżyć listy.');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch('/api/city/logout', { method: 'POST' }).catch(() => null);
    router.refresh();
  }

  function onSaved(report: Report) {
    setReports(list => list.map(r => (r.id === report.id ? report : r)));
  }

  const query = filterQuery(filter);

  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Każdy Krok · Urząd Miasta Krakowa / ZDMK</p>
            <h1 className="text-2xl font-bold">Zgłoszenia mieszkańców</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCw aria-hidden="true" className={cn(loading && 'animate-spin')} /> Odśwież
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/city/reports.csv${query ? `?${query}` : ''}`} download aria-disabled={badRange || undefined} onClick={e => badRange && e.preventDefault()}>
                <Download aria-hidden="true" /> Eksport CSV{filtered ? ' (filtr)' : ''}
              </a>
            </Button>
            <Button variant="ghost" onClick={logout}>
              <LogOut aria-hidden="true" /> Wyloguj
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6">
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="sr-only">
            Podsumowanie
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Nowe" value={stats.new} hint="Czekają na pierwszą decyzję" pressed={filter.status === 'new'} onClick={() => set({ status: filter.status === 'new' ? 'all' : 'new' })} />
            <Tile label="W trakcie analizy" value={stats.inReview} hint="Status „W trakcie analizy”" pressed={filter.status === 'in_review'} onClick={() => set({ status: filter.status === 'in_review' ? 'all' : 'in_review' })} />
            <Tile
              label="Uniemożliwiło dotarcie"
              value={stats.blockedWeek}
              hint="Ostatnie 7 dni"
              pressed={filter.type === 'blocked' && filter.from === weekAgo}
              onClick={() => (filter.type === 'blocked' && filter.from === weekAgo ? set({ type: 'all', from: undefined }) : set({ type: 'blocked', from: weekAgo }))}
            />
            <Tile label="Wszystkie" value={stats.total} hint="Pokaż wszystkie zgłoszenia" pressed={!filtered} onClick={() => setFilter(emptyCityFilter)} />
          </div>
        </section>

        <section aria-labelledby="filters-heading">
          <Card className="gap-4 p-4">
            <h2 id="filters-heading" className="text-lg font-semibold">
              Filtry
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
              <div className="grid gap-2">
                <Label htmlFor="f-q">Szukaj</Label>
                <div className="relative">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="f-q" type="search" className="pl-9" placeholder="Opis, komentarz, cel, miejsce" value={filter.q} onChange={e => set({ q: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-status">Status</Label>
                <Select value={filter.status} onValueChange={v => set({ status: v as CityFilter['status'] })}>
                  <SelectTrigger id="f-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Wszystkie statusy</SelectItem>
                    {cityStatuses.map(s => (
                      <SelectItem key={s} value={s}>
                        {cityStatusLabel[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-type">Rodzaj</Label>
                <Select value={filter.type} onValueChange={v => set({ type: v as CityFilter['type'] })}>
                  <SelectTrigger id="f-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Wszystkie rodzaje</SelectItem>
                    <SelectItem value="blocked">{reportTypeLabel.blocked}</SelectItem>
                    <SelectItem value="barrier">{reportTypeLabel.barrier}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-from">Od dnia</Label>
                <Input id="f-from" type="date" value={filter.from ?? ''} max={filter.to} onChange={e => set({ from: e.target.value || undefined })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="f-to">Do dnia</Label>
                <Input id="f-to" type="date" value={filter.to ?? ''} min={filter.from} aria-invalid={badRange} aria-describedby={badRange ? 'f-range-error' : undefined} onChange={e => set({ to: e.target.value || undefined })} />
              </div>
              {badRange && (
                <p id="f-range-error" role="alert" className="text-sm text-destructive sm:col-span-full">
                  Data „od” nie może być późniejsza niż data „do”.
                </p>
              )}
              <Button variant="ghost" onClick={() => setFilter(emptyCityFilter)} disabled={!filtered}>
                <FilterX aria-hidden="true" /> Wyczyść
              </Button>
            </div>
          </Card>
        </section>

        <section aria-labelledby="list-heading" className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="list-heading" className="text-lg font-semibold">
              Zgłoszenia
            </h2>
            <p role="status" className="text-sm text-muted-foreground">
              {visible.length === reports.length ? `${countLabel(reports.length)}, od najnowszych` : `Pokazano ${visible.length} z ${ofCountLabel(reports.length)} (filtr)`}
            </p>
          </div>
          {visible.length === 0 ? (
            <Empty className="border bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{reports.length ? 'Brak zgłoszeń dla tych filtrów' : 'Brak zgłoszeń'}</EmptyTitle>
                <EmptyDescription>{reports.length ? 'Zmień lub wyczyść filtry.' : 'Zgłoszenia mieszkańców pojawią się tutaj.'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="grid gap-3">
              {visible.map(r => (
                <ReportRow key={r.id} report={r} onOpen={() => setOpenId(r.id)} />
              ))}
            </ul>
          )}
        </section>

        <PartnerDeclarations initial={initialPartners} />
      </main>

      <ReportDetail report={open} onClose={() => setOpenId(null)} onSaved={onSaved} onUnauthorized={() => router.refresh()} />
    </div>
  );
}

function ReportRow({ report: r, onOpen }: { report: Report; onOpen: () => void }) {
  const photos = r.photos?.length ?? (r.photoPath ? 1 : 0);
  const headingId = `r-${r.id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className={cn('grid gap-4 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-[112px_1fr_auto]', typeOf(r) === 'blocked' && 'border-l-4 border-l-tram')}>
        <div className="relative size-28 shrink-0 overflow-hidden rounded-lg bg-muted">
          {r.photoPath ? (
            <img src={r.photoPath} alt={`Zdjęcie zgłoszenia: ${r.observation.description}`} loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center text-center text-xs text-muted-foreground">
              <span>
                <Camera aria-hidden="true" className="mx-auto mb-1 size-5" />
                Bez zdjęcia
              </span>
            </div>
          )}
          {photos > 1 && <span className="absolute right-1 bottom-1 rounded bg-ink/85 px-1.5 text-xs font-medium text-white">{photos} zdjęcia</span>}
        </div>

        <div className="grid min-w-0 content-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge report={r} />
            <StatusBadge report={r} />
            <time dateTime={r.obtainedAt} className="text-sm text-muted-foreground">
              {formatDate(r.obtainedAt)}
            </time>
          </div>
          <h3 id={headingId} className="font-semibold">
            {r.location?.name ?? r.locationId}
          </h3>
          <p className="line-clamp-2">
            <span className="text-sm font-medium text-muted-foreground">{r.analysis === 'comment' ? 'Opis osoby: ' : r.analysis === 'ai' ? 'Opis AI: ' : 'Opis: '}</span>
            {r.observation.description}
          </p>
          {r.comment && r.analysis !== 'comment' && (
            <p className="line-clamp-2">
              <span className="text-sm font-medium text-muted-foreground">Komentarz: </span>„{r.comment}”
            </p>
          )}
          {r.destination && (
            <p className="flex items-start gap-1.5">
              <Target aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-tram" />
              <span>
                <span className="text-sm font-medium text-muted-foreground">Cel podróży: </span>
                {r.destination}
              </span>
            </p>
          )}
          {r.location && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="size-4" />
              <span className="tabular-nums">
                {r.location.lat.toFixed(5)}, {r.location.lon.toFixed(5)}
              </span>
              <MapLinks lat={r.location.lat} lon={r.location.lon} />
            </p>
          )}
        </div>

        <div className="flex items-start sm:justify-end">
          <Button onClick={onOpen} className="w-full sm:w-auto">
            Szczegóły i status<span className="sr-only">: {r.location?.name ?? r.locationId}</span>
          </Button>
        </div>
      </article>
    </li>
  );
}
