'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Save, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cityStatusLabel, kindLabel, statusOf } from '@/lib/city-reports';
import { photoList } from '@/lib/report-photos';
import { cityStatuses, type CityStatus, type Observation, type PhotoVisibility, type Report, type ReportPhoto } from '@/lib/schemas';
import { formatDate, MapLinks, StatusBadge, TypeBadge } from './shared';
import ReportMap from './ReportMap';

type Props = { report: Report | null; onClose: () => void; onSaved: (report: Report) => void; onUnauthorized: () => void };

export default function ReportDetail({ report, onClose, onSaved, onUnauthorized }: Props) {
  return (
    <Sheet open={!!report} onOpenChange={open => !open && onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        {report && <Detail key={report.id} report={report} onSaved={onSaved} onUnauthorized={onUnauthorized} />}
      </SheetContent>
    </Sheet>
  );
}

const yesNo = { yes: 'tak', no: 'nie', unknown: 'nieznana' } as const;
const surfaceLabel = { paving_stones: 'kostka', asphalt: 'asfalt', sett: 'bruk', gravel: 'żwir', unknown: 'nieznana' } as const;

function ObservationFacts({ o }: { o: Observation }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Rodzaj</dt>
      <dd>{kindLabel[o.kind]}</dd>
      <dt className="text-muted-foreground">Poręcz</dt>
      <dd>{yesNo[o.handrail]}</dd>
      <dt className="text-muted-foreground">Nawierzchnia</dt>
      <dd>{surfaceLabel[o.surface]}</dd>
      {o.uncertainty && (
        <>
          <dt className="text-muted-foreground">Ograniczenia</dt>
          <dd>{o.uncertainty}</dd>
        </>
      )}
    </dl>
  );
}

const peopleLabel = { none: 'AI: nie widać osób ani tablic rejestracyjnych', present: 'AI: widać osoby, twarze lub tablice rejestracyjne', unclear: 'AI: nie można wykluczyć osób lub tablic' } as const;

function PhotoPrivacy({ photo, busy, onChange }: { photo: ReportPhoto; busy: boolean; onChange: (visibility: PhotoVisibility) => void }) {
  const isPublic = photo.visibility === 'public';
  return (
    <div className="grid min-w-0 gap-2 rounded-md bg-muted/50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isPublic ? 'secondary' : 'outline'}>{isPublic ? 'Publiczne' : photo.reviewedAt ? 'Ukryte przez urząd' : 'Ukryte — czeka na sprawdzenie'}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {photo.people ? peopleLabel[photo.people] : 'AI nie sprawdziło tego zdjęcia — sprawdź, czy nie widać osób ani tablic rejestracyjnych.'}
        {photo.reviewedAt && <> · decyzja urzędu {formatDate(photo.reviewedAt)}</>}
      </p>
      {isPublic ? (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onChange('hidden')} className="h-auto min-h-8 justify-self-start whitespace-normal py-1.5 text-left">
          <EyeOff aria-hidden="true" /> Ukryj zdjęcie przed mieszkańcami
        </Button>
      ) : (
        <Button type="button" size="sm" disabled={busy} onClick={() => onChange('public')} className="h-auto min-h-8 justify-self-start whitespace-normal py-1.5 text-left">
          <Eye aria-hidden="true" /> Opublikuj zdjęcie (nie widać osób ani tablic)
        </Button>
      )}
    </div>
  );
}

function Detail({ report: r, onSaved, onUnauthorized }: { report: Report; onSaved: (report: Report) => void; onUnauthorized: () => void }) {
  const [status, setStatus] = useState<CityStatus>(statusOf(r));
  const [note, setNote] = useState(r.cityNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = status !== statusOf(r) || note.trim() !== (r.cityNote ?? '');
  const photos: ReportPhoto[] = photoList(r);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);

  async function setVisibility(photo: ReportPhoto, visibility: PhotoVisibility) {
    setPhotoBusy(photo.id);
    try {
      const response = await fetch(`/api/city/reports/${encodeURIComponent(r.id)}/photos/${encodeURIComponent(photo.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });
      if (response.status === 401) return onUnauthorized();
      const body = (await response.json().catch(() => null)) as { report?: Report; error?: string } | null;
      if (!response.ok || !body?.report) throw new Error(body?.error ?? 'Nie udało się zapisać decyzji o zdjęciu.');
      onSaved(body.report);
      toast.success(visibility === 'public' ? 'Zdjęcie jest teraz publiczne.' : 'Zdjęcie jest ukryte przed mieszkańcami.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie udało się zapisać decyzji o zdjęciu.');
    } finally {
      setPhotoBusy(null);
    }
  }
  const title = r.location?.name ?? r.locationId;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/city/reports/${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: note.trim() }),
      });
      if (response.status === 401) return onUnauthorized();
      const body = (await response.json().catch(() => null)) as { report?: Report; error?: string } | null;
      if (!response.ok || !body?.report) throw new Error(body?.error ?? 'Nie udało się zapisać.');
      onSaved(body.report);
      toast.success('Zapisano status zgłoszenia.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SheetHeader className="sticky top-0 z-10 border-b bg-background">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <TypeBadge report={r} />
              <StatusBadge report={r} />
            </div>
            <SheetTitle className="text-xl">{title}</SheetTitle>
            <SheetDescription>
              Zgłoszone <time dateTime={r.obtainedAt}>{formatDate(r.obtainedAt)}</time> · niezweryfikowane · ID {r.id.slice(0, 8)}
            </SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Zamknij szczegóły">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
      </SheetHeader>

      <div className="grid gap-6 p-4">
        <section aria-labelledby="d-desc" className="grid gap-2">
          <h3 id="d-desc" className="font-semibold">
            {r.analysis === 'comment' ? 'Opis osoby zgłaszającej' : r.analysis === 'ai' ? 'Opis AI (ze zdjęcia)' : r.analysis === 'edited' ? 'Opis poprawiony przez autora' : 'Opis'}
          </h3>
          <p>{r.observation.description}</p>
          {r.analysis !== 'comment' && <ObservationFacts o={r.observation} />}
          {r.comment && r.analysis !== 'comment' && (
            <>
              <h4 className="mt-2 text-sm font-semibold">Komentarz osoby zgłaszającej</h4>
              <blockquote className="border-l-4 border-primary/40 pl-3">{r.comment}</blockquote>
            </>
          )}
          {r.destination && (
            <p>
              <span className="font-semibold">Cel podróży: </span>
              {r.destination}
            </p>
          )}
        </section>

        {r.location && (
          <section aria-labelledby="d-loc" className="grid gap-2">
            <h3 id="d-loc" className="font-semibold">
              Lokalizacja
            </h3>
            <p className="text-sm">
              {r.location.name} · <span className="tabular-nums">{r.location.lat.toFixed(5)}, {r.location.lon.toFixed(5)}</span>
              {r.locationSource && <> · źródło: {r.locationSource === 'gps' ? 'GPS telefonu' : r.locationSource === 'map' ? 'wskazane na mapie' : 'obiekt z mapy'}</>}
            </p>
            <p className="text-sm">
              <MapLinks lat={r.location.lat} lon={r.location.lon} />
            </p>
            <ReportMap lat={r.location.lat} lon={r.location.lon} label={`Mapa: ${r.location.name}`} />
          </section>
        )}

        <section aria-labelledby="d-photos" className="grid gap-3">
          <h3 id="d-photos" className="font-semibold">
            Zdjęcia ({photos.length})
          </h3>
          {photos.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Zdjęcia, na których mogą być osoby lub tablice rejestracyjne, są ukryte przed mieszkańcami, dopóki ich nie opublikujesz.
            </p>
          )}
          {photos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zgłoszenie bez zdjęcia.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
              {photos.map((p, i) => (
                <li key={p.id} className="grid min-w-0 content-start gap-2 rounded-lg border bg-card p-2">
                  <a href={p.path} target="_blank" rel="noreferrer" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.path} alt={`Zdjęcie ${i + 1}${p.analysis ? `: ${p.analysis.description}` : ''} (otwórz w pełnym rozmiarze)`} loading="lazy" className="aspect-[4/3] w-full rounded-md bg-muted object-cover" />
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Zdjęcie {i + 1} · <time dateTime={p.createdAt}>{formatDate(p.createdAt)}</time>
                  </p>
                  {p.analysis ? (
                    <div className="grid gap-1">
                      <p className="text-sm">
                        <span className="font-medium">AI: </span>
                        {p.analysis.description}
                      </p>
                      <ObservationFacts o={p.analysis} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Brak opisu AI dla tego zdjęcia.</p>
                  )}
                  <PhotoPrivacy photo={p} busy={photoBusy === p.id} onChange={v => setVisibility(p, v)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <Separator />

        <section aria-labelledby="d-status" className="grid gap-3">
          <h3 id="d-status" className="font-semibold">
            Obsługa zgłoszenia
          </h3>
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="d-status-select">Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as CityStatus)}>
                <SelectTrigger id="d-status-select" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cityStatuses.map(s => (
                    <SelectItem key={s} value={s}>
                      {cityStatusLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="d-note">Odpowiedź dla mieszkańców (publiczna)</Label>
              <Textarea
                id="d-note"
                value={note}
                maxLength={1000}
                rows={4}
                onChange={e => setNote(e.target.value)}
                aria-describedby="d-note-hint"
                placeholder="Np. Przekazano do ZDMK, naprawa krawężnika zaplanowana na listopad."
              />
              <p id="d-note-hint" className="text-sm text-muted-foreground">
                Widoczna w aplikacji przy zgłoszeniu. Nie wpisuj danych osobowych. {note.length}/1000
              </p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={saving || !dirty}>
                <Save aria-hidden="true" /> {saving ? 'Zapisywanie…' : 'Zapisz'}
              </Button>
            </div>
          </form>

          <h4 className="mt-2 text-sm font-semibold">Historia zmian</h4>
          {r.cityHistory?.length ? (
            <ol className="grid gap-2 text-sm">
              {[...r.cityHistory].reverse().map(h => (
                <li key={h.at} className="rounded-md border bg-card p-2">
                  <time dateTime={h.at} className="text-muted-foreground">
                    {formatDate(h.at)}
                  </time>{' '}
                  ·{' '}
                  {h.photo ? (
                    <span className="font-medium">
                      Zdjęcie {Math.max(1, photos.findIndex(p => p.id === h.photo!.id) + 1)}: {h.photo.visibility === 'public' ? 'opublikowane' : 'ukryte'}
                    </span>
                  ) : (
                    <>
                      <span className="font-medium">{cityStatusLabel[h.status]}</span>
                      {h.note && <p className="mt-1">{h.note}</p>}
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">Bez zmian od zgłoszenia.</p>
          )}
        </section>
      </div>
    </>
  );
}
