'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Copy, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { CityPlace } from '@/lib/city-types';
import { errorText, postJson, requestJson } from '@/lib/client';
import type { FeatureKey, FeatureValue, ObjectCategory, PlaceObject } from '@/lib/explore-types';
import { useI18n } from '@/lib/i18n/client';
import { PARTNER_TOKEN_HEADER, rememberPartnerToken, touchPartnerWrite } from '@/lib/partner-tokens';
import type { PartnerRecord } from '@/lib/objects';
import { categories } from './Explore';
import { Panel } from './Panel';
import { PlaceInput } from './PlaceInput';

const editable: FeatureKey[] = ['step_free_entrance', 'entrance_steps', 'ramp', 'lift', 'door_width', 'automatic_door', 'accessible_toilet', 'disabled_parking', 'seating', 'staff_assistance'];
type Row = { value: FeatureValue | 'none'; detail: string };

function embedCode(origin: string, place: { lat: number; lon: number; name: string }) {
  const src = `${origin}/embed?to=${place.lat.toFixed(5)},${place.lon.toFixed(5)}&name=${encodeURIComponent(place.name)}`;
  return `<iframe src="${src}" title="${place.name.replace(/"/g, '&quot;')}" width="100%" height="680" style="border:0" loading="lazy" allow="geolocation"></iframe>`;
}

/** With `edit` the form corrects the owner's own declaration (loaded with the token from this browser) instead of adding one. */
export function PartnerForm({ open, existing, edit, onClose, onSaved }: {
  open: boolean;
  existing: PlaceObject | null;
  edit?: { id: string; token: string } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ObjectCategory>('hotel');
  const [place, setPlace] = useState<CityPlace | null>(null);
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [plan, setPlan] = useState<'free' | 'partner'>('free');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [existingId, setExistingId] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<{ lat: number; lon: number; name: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDone(null);
    setName(existing?.name ?? '');
    setCategory(existing?.category && existing.category !== 'parking' ? existing.category : 'hotel');
    setPlace(existing ? { id: existing.id, name: existing.address ?? existing.name, lat: existing.lat, lon: existing.lon, source: 'object' } : null);
    setWebsite(existing?.website ?? '');
    setRows({});
    setEmail('');
    setDescription('');
    setPlan('free');
    setExistingId(undefined);
    if (!edit) return;
    const controller = new AbortController();
    setLoading(true);
    requestJson('GET', `/api/partners/objects/${edit.id}?locale=${locale}`, undefined, 35000, { [PARTNER_TOKEN_HEADER]: edit.token }, controller.signal)
      .then(({ declaration: d }: { declaration: PartnerRecord }) => {
        setName(d.name);
        setCategory(d.category);
        setPlace({ id: d.existingObjectId ?? `partner-${d.id}`, name: d.address ?? d.name, lat: d.lat, lon: d.lon, source: 'object' });
        setWebsite(d.website ?? '');
        setEmail(d.contactEmail);
        setDescription(d.description ?? '');
        setPlan(d.plan);
        setExistingId(d.existingObjectId);
        setRows(Object.fromEntries(d.features.map(f => [f.key, { value: f.value === 'unknown' ? 'none' : f.value, detail: f.detail ?? '' } as Row])));
        setLoading(false);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        toast.error(errorText(err, t('partner.failed')));
        onClose();
      });
    return () => controller.abort();
  }, [open, existing, edit?.id, edit?.token, locale]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!place) {
      toast.error(t('partner.failed'));
      return;
    }
    setBusy(true);
    try {
      const features = Object.entries(rows)
        .filter(([, r]) => r.value !== 'none')
        .map(([key, r]) => ({ key, value: r.value, ...(r.detail.trim() ? { detail: r.detail.trim() } : {}) }));
      const payload = {
        name: name.trim(),
        category,
        lat: place.lat,
        lon: place.lon,
        address: place.name,
        ...(website.trim() ? { website: website.trim() } : {}),
        contactEmail: email.trim(),
        features,
        ...(description.trim() ? { description: description.trim() } : {}),
        promote: plan === 'partner',
        plan,
        ...(edit ? (existingId ? { existingObjectId: existingId } : {}) : existing ? { existingObjectId: existing.id } : {}),
      };
      if (edit) {
        await requestJson('PATCH', `/api/partners/objects/${edit.id}?locale=${locale}`, payload, 35000, { [PARTNER_TOKEN_HEADER]: edit.token });
        touchPartnerWrite();
        toast.success(t('partner.corrected'));
        onSaved?.();
        onClose();
        return;
      }
      const data = await postJson(`/api/partners/objects?locale=${locale}`, payload);
      // The token is shown to nobody: it only lives in this browser, which is what lets the owner correct or withdraw later.
      rememberPartnerToken(data.partnerId, data.editToken);
      touchPartnerWrite();
      toast.success(t('partner.sent'));
      onSaved?.();
      setDone({ lat: place.lat, lon: place.lon, name: name.trim() });
    } catch (err) {
      toast.error(errorText(err, t('partner.failed')));
    } finally {
      setBusy(false);
    }
  }

  const code = done ? embedCode(window.location.origin, done) : '';

  return (
    <Panel open={open} onOpenChange={o => !o && onClose()} title={edit ? t('partner.editTitle') : t('partner.title')} description={edit ? t('partner.editDescription') : t('partner.description')}>
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
          {t('explore.loading')}
        </p>
      ) : done ? (
        <div className="flex flex-col gap-3 pt-2">
          <Label htmlFor="embed-code" className="text-base font-semibold">{t('partner.embed')}</Label>
          <p className="text-sm text-muted-foreground">{t('partner.embedHint')}</p>
          <Textarea id="embed-code" readOnly value={code} className="min-h-28 font-mono text-xs" onFocus={e => e.currentTarget.select()} />
          <Button
            className="h-11 self-start"
            onClick={async () => {
              await navigator.clipboard.writeText(code);
              toast.success(t('partner.copied'));
            }}
          >
            <Copy />
            {t('partner.copy')}
          </Button>
          <Button variant="outline" className="h-11 self-start" asChild>
            <a href={code.match(/src="([^"]+)"/)?.[1]} target="_blank" rel="noreferrer">
              {t('embed.title')}
            </a>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4 pt-2">
          <Field id="p-name" label={t('partner.name')}>
            <Input id="p-name" required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} className="h-11 text-base" />
          </Field>
          <Field id="p-category" label={t('partner.category')}>
            <Select value={category} onValueChange={v => setCategory(v as ObjectCategory)}>
              <SelectTrigger id="p-category" className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{t(`cat.${c}`)}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('partner.location')}</span>
            <div className="rounded-xl border bg-card p-1">
              <PlaceInput label={t('partner.location')} placeholder={t('search.toPlaceholder')} value={place} onChange={setPlace} marker="end" onError={m => toast.error(m)} />
            </div>
          </div>
          <Field id="p-web" label={t('partner.website')}>
            <Input id="p-web" type="url" inputMode="url" value={website} onChange={e => setWebsite(e.target.value)} className="h-11 text-base" placeholder="https://" />
          </Field>
          <Field id="p-email" label={t('partner.email')}>
            <Input id="p-email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="h-11 text-base" />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t('partner.features')}</legend>
            {editable.map(key => {
              const row = rows[key] ?? { value: 'none', detail: '' };
              return (
                <div key={key} className="grid grid-cols-[1fr_8.5rem] items-center gap-2 rounded-lg border bg-card p-2">
                  <Label htmlFor={`f-${key}`} className="text-sm font-normal">{t(`feature.${key}`)}</Label>
                  <Select value={row.value} onValueChange={v => setRows(r => ({ ...r, [key]: { ...row, value: v as Row['value'] } }))}>
                    <SelectTrigger id={`f-${key}`} className="h-10 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {(['yes', 'limited', 'no'] as const).map(v => <SelectItem key={v} value={v}>{t(`fvalue.${v}`)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {row.value !== 'none' ? (
                    <Input
                      aria-label={`${t(`feature.${key}`)}: ${t('partner.detail')}`}
                      placeholder={t('partner.detail')}
                      maxLength={120}
                      value={row.detail}
                      onChange={e => setRows(r => ({ ...r, [key]: { ...row, detail: e.target.value } }))}
                      className="col-span-2 h-10"
                    />
                  ) : null}
                </div>
              );
            })}
          </fieldset>

          <Field id="p-about" label={t('partner.about')}>
            <Textarea id="p-about" maxLength={600} value={description} onChange={e => setDescription(e.target.value)} className="min-h-20 text-base" />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">{t('partner.plan')}</legend>
            <RadioGroup value={plan} onValueChange={v => setPlan(v as 'free' | 'partner')} className="gap-2">
              {([['free', 'partner.free', 'partner.freeDesc'], ['partner', 'partner.paid', 'partner.paidDesc']] as const).map(([value, title, desc]) => (
                <Label key={value} htmlFor={`plan-${value}`} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent">
                  <RadioGroupItem id={`plan-${value}`} value={value} className="mt-0.5" />
                  <span>
                    <span className="block font-semibold">{t(title)}</span>
                    <span className="block text-sm text-muted-foreground">{t(desc)}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>

          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{t('partner.tokenNote')}</p>

          <Button type="submit" size="lg" className="h-12 text-base" disabled={busy || !place}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {edit ? t('partner.saveChanges') : t('partner.submit')}
          </Button>
        </form>
      )}
    </Panel>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
