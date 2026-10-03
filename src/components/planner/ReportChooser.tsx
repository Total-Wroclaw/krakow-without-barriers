'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Camera, ImagePlus, LoaderCircle, Route, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { CityPlace } from '@/lib/city-types';
import { errorText, postJson } from '@/lib/client';
import { useI18n } from '@/lib/i18n/client';
import type { Report } from '@/lib/schemas';
import { Panel } from './Panel';
import { gpsPoint, inKrakow, rememberToken, reportToken, shrink, type CaptureTarget } from './Reports';

type Where = 'gps' | 'selected' | 'map';
const MAX_PHOTOS = 4;

/**
 * Entry point of the "Zgłoś" button: one-tap obstacle photo, or a report that something
 * prevented the trip (with comment, destination and optional photos) for the city office.
 */
export function ReportChooser({ open, onOpenChange, onPhoto, selected, mapPoint, destination, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPhoto: () => void;
  /** Place the user is looking at (fact, place or route destination), if any. */
  selected: CaptureTarget | null;
  mapPoint: () => CaptureTarget;
  destination?: string;
  onSaved: (r: Report) => void;
}) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'choose' | 'blocked'>('choose');
  const [where, setWhere] = useState<Where>('gps');
  const [target, setTarget] = useState('');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [commentError, setCommentError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('choose');
    setWhere(selected ? 'selected' : 'gps');
    setTarget(destination ?? '');
    setComment('');
    setPhotos([]);
  }, [open, selected, destination]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...photos];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_PHOTOS) break;
      if (file.size > 15_000_000) {
        toast.error(t('report.tooBig'));
        continue;
      }
      try {
        next.push(await shrink(file));
      } catch {
        toast.error(t('report.failed'));
      }
    }
    setPhotos(next);
  }

  async function locate(): Promise<CaptureTarget> {
    if (where === 'selected' && selected) return selected;
    if (where === 'gps') {
      const gps = await gpsPoint();
      if (gps && inKrakow(gps)) return { place: { id: `point:${gps.lat}:${gps.lon}`, name: t('report.photoPlace'), lat: gps.lat, lon: gps.lon, source: 'GPS' }, source: 'map' };
      toast.warning(t('search.geoDenied'));
    }
    return mapPoint();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (comment.trim().length < 3 && !photos.length) {
      setCommentError(true);
      document.getElementById('blocked-comment')?.focus();
      return;
    }
    setBusy(true);
    const id = toast.loading(t('report.sending'));
    try {
      const at = await locate();
      const gpsUsed = where === 'gps' && at.place.source === 'GPS';
      const data = await postJson(
        '/api/reports/auto',
        {
          type: 'blocked',
          comment: comment.trim() || undefined,
          destination: target.trim() || undefined,
          location: at.place,
          locationSource: gpsUsed ? 'gps' : at.source,
          ...(at.factId && !gpsUsed ? { factId: at.factId } : {}),
          ...(photos[0] ? { photo: photos[0] } : {}),
          locale,
        },
        60000,
      );
      let report = data.report as Report;
      rememberToken(report.id, data.editToken);
      // Further photos are attached one by one; each is analysed separately.
      for (const photo of photos.slice(1)) {
        try {
          const more = await postJson(`/api/reports/${report.id}/photos?locale=${locale}`, { photo, locale }, 60000, { 'x-report-token': reportToken(report.id) ?? '' });
          if (more.report) report = more.report as Report;
        } catch {}
      }
      onSaved(report);
      toast.success(t('report.sent'), { id });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, t('report.failed')), { id });
    } finally {
      setBusy(false);
    }
  }

  const selectedName = selected?.place.name;

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={mode === 'blocked' ? t('report.blockedTitle') : t('report.chooserTitle')} description={mode === 'choose' ? t('report.chooserDesc') : t('report.blockedOptionDesc')}>
      {mode === 'choose' ? (
        <div className="flex flex-col gap-3 pt-2">
          <ChoiceButton icon={Camera} title={t('report.photoOption')} description={t('report.photoOptionDesc')} onClick={() => { onOpenChange(false); onPhoto(); }} />
          <ChoiceButton icon={Route} title={t('report.blockedOption')} description={t('report.blockedOptionDesc')} onClick={() => setMode('blocked')} />
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 pt-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t('report.where')}</legend>
            <RadioGroup value={where} onValueChange={v => setWhere(v as Where)} className="gap-2">
              {([
                ['gps', t('report.whereGps')],
                ...(selectedName ? [['selected', t('report.whereSelected', { name: selectedName })] as const] : []),
                ['map', t('report.whereMap')],
              ] as const).map(([value, label]) => (
                <Label key={value} htmlFor={`where-${value}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent">
                  <RadioGroupItem id={`where-${value}`} value={value} />
                  {label}
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blocked-destination">{t('report.destination')}</Label>
            <Input id="blocked-destination" value={target} maxLength={200} onChange={e => setTarget(e.target.value)} className="h-11 text-base" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="blocked-comment">{t('report.comment')}</Label>
            {commentError ? <p id="blocked-comment-error" className="text-sm font-medium text-destructive">{t('report.needComment')}</p> : null}
            <Textarea id="blocked-comment" value={comment} maxLength={800} aria-invalid={commentError || undefined} aria-describedby={commentError ? 'blocked-comment-error' : undefined} onChange={e => { setComment(e.target.value); setCommentError(false); }} placeholder={t('report.commentPlaceholder')} className="min-h-24 text-base" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="blocked-photos">{t('report.photos')}</span>
            <div className="flex flex-wrap gap-2" aria-labelledby="blocked-photos">
              {photos.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-20 rounded-lg object-cover" />
                  <button type="button" onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-ink text-white" aria-label={t('report.removePhoto', { n: i + 1 })}>
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <label className="grid size-20 cursor-pointer place-items-center rounded-lg border border-dashed bg-card text-muted-foreground hover:border-primary focus-within:ring-2 focus-within:ring-ring">
                  <ImagePlus className="size-6" aria-hidden />
                  <span className="sr-only">{t('report.addPhoto')}</span>
                  <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                </label>
              ) : null}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">{t('report.publicNote')}</p>
          <Button type="submit" size="lg" className="h-12 text-base" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {t('report.send')}
          </Button>
        </form>
      )}
    </Panel>
  );
}

function ChoiceButton({ icon: Icon, title, description, onClick }: { icon: typeof Camera; title: string; description: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left hover:border-primary">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
