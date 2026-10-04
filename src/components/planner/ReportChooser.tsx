'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Camera, ImagePlus, LoaderCircle, Route, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CityPlace } from '@/lib/city-types';
import { errorText } from '@/lib/client';
import { useI18n } from '@/lib/i18n/client';
import { prepareReportSubmission, sendReportSubmission, type ReportSubmission } from '@/lib/report-submission';
import type { Report } from '@/lib/schemas';
import { Panel } from './Panel';
import { LocationPicker, gpsPlace } from './LocationPicker';
import { rememberToken, shrink, type CaptureTarget } from './Reports';

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
  const [place, setPlace] = useState<CityPlace | null>(null);
  const [target, setTarget] = useState('');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [commentError, setCommentError] = useState(false);
  const [submission, setSubmission] = useState<ReportSubmission | null>(null);
  const [submissionError, setSubmissionError] = useState('');

  useEffect(() => {
    if (!open || submission) return;
    setMode('choose');
    // Start from what the person is looking at (a place or barrier), else the map centre; they confirm or move it.
    setPlace((selected ?? mapPoint()).place);
    setTarget(destination ?? '');
    setComment('');
    setPhotos([]);
    setCommentError(false);
    setSubmissionError('');
  }, [open, selected, destination, submission]);

  useEffect(() => {
    if (!submission) return;
    const preventLoss = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [submission]);

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!submission && comment.trim().length < 3 && !photos.length) {
      setCommentError(true);
      document.getElementById('blocked-comment')?.focus();
      return;
    }
    setBusy(true);
    setSubmissionError('');
    const id = toast.loading(t('report.sending'));
    let current = submission;
    try {
      const at = place ?? mapPoint().place;
      const fromSelected = !!selected && at.lat === selected.place.lat && at.lon === selected.place.lon;
      current ??= prepareReportSubmission({
        type: 'blocked', comment: comment.trim() || undefined, destination: target.trim() || undefined,
        location: at, locationSource: at.source === 'GPS' ? 'gps' : fromSelected ? 'fact' : 'map',
        ...(fromSelected && selected?.factId ? { factId: selected.factId } : {}), locale,
      }, photos);
      setSubmission(current);
      // Save authorship before the first request: even a lost creation response must remain recoverable.
      if (!rememberToken(current.id, current.token)) throw new Error();
      const active = current;
      await sendReportSubmission(active, report => { onSaved(report); setSubmission({ ...active }); });
      toast.success(t('report.sent'), { id });
      onOpenChange(false);
      setSubmission(null);
    } catch (err) {
      if (current) setSubmission({ ...current });
      const message = current?.report ? t('report.partial', { n: current.pending.length }) : errorText(err, t(current ? 'report.retryUnconfirmed' : 'report.failed'));
      setSubmissionError(message);
      toast.error(message, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel open={open} onOpenChange={next => !busy && onOpenChange(next)} title={mode === 'blocked' ? t('report.blockedTitle') : t('report.chooserTitle')} description={mode === 'choose' ? t('report.chooserDesc') : t('report.blockedOptionDesc')}>
      {mode === 'choose' ? (
        <div className="flex flex-col gap-3 pt-2">
          <ChoiceButton icon={Camera} title={t('report.photoOption')} description={t('report.photoOptionDesc')} onClick={() => { onOpenChange(false); onPhoto(); }} />
          <ChoiceButton icon={Route} title={t('report.blockedOption')} description={t('report.blockedOptionDesc')} onClick={() => setMode('blocked')} />
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 pt-2">
          {submission ? (
            <>
              <Alert role={submissionError ? 'alert' : 'status'}>
                <AlertDescription>{submissionError || t(submission.report ? 'report.uploadingPhotos' : 'report.sending')}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                {submission.pending.map((photo, i) => (
                  <img key={photo.id} src={photo.photo} width={80} height={80} alt={t('report.pendingPhoto', { n: i + 1 })} className="size-20 rounded-lg object-cover" />
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{t('report.retryHint')}</p>
              <Button type="submit" size="lg" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : null}{t('report.retry')}</Button>
            </>
          ) : <>
          {submissionError ? <Alert role="alert"><AlertDescription>{submissionError}</AlertDescription></Alert> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t('report.where')}</legend>
            {place ? (
              <LocationPicker
                value={place}
                onChange={setPlace}
                presets={[
                  { key: 'gps', label: t('report.whereGps'), place: () => gpsPlace(t('report.photoPlace'), locale).then(p => p ?? (toast.warning(t('search.geoDenied')), null)) },
                  ...(selected ? [{ key: 'selected', label: t('report.whereSelectedShort'), place: selected.place }] : []),
                  { key: 'map', label: t('report.whereMap'), place: mapPoint().place },
                ]}
              />
            ) : null}
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
          </>}
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
