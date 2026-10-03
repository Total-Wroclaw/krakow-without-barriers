'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { CityPlace } from '@/lib/city-types';
import { postJson } from '@/lib/client';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { observationSchema, type Observation, type Report } from '@/lib/schemas';
import { Panel } from './Panel';
import { StatusRow } from './FactSheet';

const kindKeys: Record<Observation['kind'], MessageKey> = { stairs: 'kind.stairs', entrance: 'kind.entrance', bench: 'kind.bench', surface: 'kind.surface', other: 'kind.other' };
const handrailKeys: Record<Observation['handrail'], MessageKey> = { yes: 'value.yesVisible', no: 'value.no', unknown: 'value.unknown' };
const surfaceKeys: Record<Observation['surface'], MessageKey> = { paving_stones: 'surface.paving_stones', asphalt: 'surface.asphalt', sett: 'surface.sett', gravel: 'surface.gravel', unknown: 'value.unknown' };
const directionKeys: Record<Observation['direction'], MessageKey> = { up: 'fact.up', down: 'fact.down', unknown: 'value.unknown' };

export function useReportTitle() {
  const { t } = useI18n();
  return useCallback(
    (r: Report) => {
      const o = r.observation;
      if (r.type === 'blocked') return t('report.blockedTitle');
      if (o.kind === 'stairs' && o.handrail !== 'unknown') return t(o.handrail === 'yes' ? 'kind.stairsRail' : 'kind.stairsNoRail');
      return t(kindKeys[o.kind]);
    },
    [t],
  );
}

export async function shrink(file: File) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.82);
}

export function gpsPoint(): Promise<{ lat: number; lon: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve =>
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    ),
  );
}

export const inKrakow = (p: { lat: number; lon: number }) => p.lat >= 49.94 && p.lat <= 50.2 && p.lon >= 19.75 && p.lon <= 20.25;

export type CaptureTarget = { place: CityPlace; source: 'map' | 'fact'; factId?: string };

/**
 * One-tap photo report: camera → AI analysis → saved as an unverified report.
 * The location comes from GPS, or from the fact/place/map point the user is looking at.
 */
export function useReportCapture({ fallback, onSaved, onOpen }: {
  fallback: () => CaptureTarget;
  onSaved: (r: Report) => void;
  onOpen: (r: Report, editing: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const reportTitle = useReportTitle();
  const input = useRef<HTMLInputElement | null>(null);
  const target = useRef<CaptureTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/*';
    el.setAttribute('capture', 'environment');
    el.className = 'sr-only';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    input.current = el;
    return () => el.remove();
  }, []);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.onchange = async () => {
      const file = el.files?.[0];
      el.value = '';
      if (!file) return;
      if (file.size > 15_000_000) {
        toast.error(t('report.tooBig'));
        return;
      }
      setBusy(true);
      const id = toast.loading(t('report.analysing'));
      try {
        const [photo, gps] = await Promise.all([shrink(file), target.current?.source === 'fact' ? null : gpsPoint()]);
        const chosen = target.current ?? fallback();
        const useGps = gps && inKrakow(gps);
        const location: CityPlace = useGps
          ? { id: `point:${gps.lat}:${gps.lon}`, name: t('report.photoPlace'), lat: gps.lat, lon: gps.lon, source: 'GPS' }
          : chosen.place;
        const data = await postJson('/api/reports/auto', {
          photo,
          location,
          locale,
          locationSource: useGps ? 'gps' : chosen.source,
          ...(chosen.factId && !useGps ? { factId: chosen.factId } : {}),
        }, 45000);
        const report = data.report as Report;
        onSaved(report);
        if (report.analysis === 'failed') {
          toast.warning(t('report.noAi'), { id });
          onOpen(report, true);
        } else {
          toast.success(t('report.added', { title: reportTitle(report) }), {
            id,
            description: report.observation.description,
            action: { label: t('report.fix'), onClick: () => onOpen(report, true) },
          });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('report.failed'), { id });
      } finally {
        setBusy(false);
        target.current = null;
      }
    };
  }, [fallback, onSaved, onOpen, t, locale, reportTitle]);

  function capture(at?: CaptureTarget) {
    target.current = at ?? null;
    input.current?.click();
  }

  return { capture, busy };
}

export function ReportFab({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Button
      onClick={onClick}
      disabled={busy}
      size="lg"
      aria-label={t('report.buttonLabel')}
      className="h-12 gap-2 rounded-full px-4 text-base shadow-lg shadow-ink/25 lg:h-14 lg:px-5"
    >
      {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Camera className="size-5" />}
      {t('report.button')}
    </Button>
  );
}

export function ReportPanel({ report, editing: startEditing, onClose, onChange, onDelete }: {
  report: Report | null;
  editing: boolean;
  onClose: () => void;
  onChange: (r: Report) => void;
  onDelete: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const reportTitle = useReportTitle();
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<Observation | null>(report?.observation ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(startEditing);
    setDraft(report?.observation ?? null);
  }, [report, startEditing]);

  if (!report || !draft) return null;

  async function save() {
    if (!report || !draft) return;
    const parsed = observationSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(t('report.short'));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/reports/${report.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ observation: parsed.data }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChange(data.report);
      setEditing(false);
      toast.success(t('report.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('report.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!report) return;
    setBusy(true);
    const res = await fetch(`/api/reports/${report.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) {
      toast.error(t('report.deleteFailed'));
      return;
    }
    onDelete(report.id);
    toast.success(t('report.deleted'));
  }

  const set = <K extends keyof Observation>(key: K, value: Observation[K]) => setDraft(d => (d ? { ...d, [key]: value } : d));

  return (
    <Panel open onOpenChange={open => !open && onClose()} title={reportTitle({ ...report, observation: draft })}>
      <div className="flex flex-col gap-5 pt-1">
        {report.photoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={report.photoPath} alt={t('report.photoAlt', { description: draft.description })} className="max-h-72 w-full rounded-xl bg-muted object-cover" />
        ) : null}

        {editing ? (
          <div className="flex flex-col gap-4">
            <Field label={t('report.kind')} id="r-kind">
              <Select value={draft.kind} onValueChange={v => set('kind', v as Observation['kind'])}>
                <SelectTrigger id="r-kind" className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(kindKeys).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('report.rail')} id="r-rail">
                <Select value={draft.handrail} onValueChange={v => set('handrail', v as Observation['handrail'])}>
                  <SelectTrigger id="r-rail" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(handrailKeys).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label={t('report.surface')} id="r-surface">
                <Select value={draft.surface} onValueChange={v => set('surface', v as Observation['surface'])}>
                  <SelectTrigger id="r-surface" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(surfaceKeys).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            {draft.kind === 'stairs' ? (
              <Field label={t('report.direction')} id="r-dir">
                <Select value={draft.direction} onValueChange={v => set('direction', v as Observation['direction'])}>
                  <SelectTrigger id="r-dir" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(directionKeys).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field label={t('report.description')} id="r-desc">
              <Textarea id="r-desc" value={draft.description} maxLength={800} onChange={e => set('description', e.target.value)} className="min-h-24 text-base" />
            </Field>
            <div className="flex gap-2">
              <Button className="h-11 flex-1" onClick={save} disabled={busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}{t('report.save')}
              </Button>
              <Button variant="outline" className="h-11" onClick={() => { setDraft(report.observation); setEditing(false); }}>
                {t('report.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-base">{draft.description}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Detail term={t('report.rail')} value={t(handrailKeys[draft.handrail])} />
              <Detail term={t('report.surface')} value={t(surfaceKeys[draft.surface])} />
              {draft.kind === 'stairs' ? <Detail term={t('report.direction')} value={t(directionKeys[draft.direction])} /> : null}
              <Detail term={t('report.place')} value={report.locationSource === 'gps' ? t('report.fromGps') : report.location?.name ?? t('report.mapPoint')} />
            </dl>
            <Button variant="outline" className="h-11 self-start" onClick={() => setEditing(true)}>
              {t('report.edit')}
            </Button>
          </div>
        )}

        {report.photos && report.photos.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {report.photos.slice(1).map(p => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.path} alt={t('report.photoAlt', { description: p.analysis?.description ?? draft.description })} className="size-24 rounded-lg bg-muted object-cover" />
            ))}
          </div>
        ) : null}
        {report.comment ? <p className="rounded-lg bg-muted/70 p-3 text-sm">{report.comment}</p> : null}
        {(report.photos?.length ?? (report.photoPath ? 1 : 0)) < 4 ? (
          <AddPhoto reportId={report.id} onAdded={onChange} />
        ) : null}
        {report.cityStatus ? (
          <StatusRow tone="city" label={t('report.cityStatus', { status: t(`city.${report.cityStatus}`) })}>
            {report.cityNote ? (
              <>
                <span className="font-medium text-foreground">{t('report.cityReply')}: </span>
                {report.cityNote}
              </>
            ) : null}
          </StatusRow>
        ) : null}

        <StatusRow tone="report" label={t('report.status')}>
          {t('report.addedOn', { date: formatDate(report.obtainedAt, locale) })}
          {report.analysis === 'ai' ? ` ${t('report.byAi')}` : report.analysis === 'edited' ? ` ${t('report.byAuthor')}` : ''}
        </StatusRow>

        <Button variant="ghost" className="h-11 self-start text-destructive hover:text-destructive" onClick={remove} disabled={busy}>
          <Trash2 />
          {t('report.delete')}
        </Button>
      </div>
    </Panel>
  );
}

function AddPhoto({ reportId, onAdded }: { reportId: string; onAdded: (r: Report) => void }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <label className="inline-flex h-11 cursor-pointer items-center gap-2 self-start rounded-md border bg-card px-4 text-sm font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring">
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
      {t('report.morePhotos')}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={async e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const data = await postJson(`/api/reports/${reportId}/photos`, { photo: await shrink(file), locale }, 60000);
            onAdded(data.report as Report);
            toast.success(t('report.photoAdded'));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t('report.failed'));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
