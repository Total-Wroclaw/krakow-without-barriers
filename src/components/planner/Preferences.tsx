'use client';
import { useState } from 'react';
import { Accessibility, Armchair, ArrowDown, ArrowUp, Baby, Ban, Footprints, Grip, LoaderCircle, SlidersHorizontal, Sparkles, Toilet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { errorText, postJson } from '@/lib/client';
import { distance } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { preferencesSchema, type Preferences } from '@/lib/schemas';
import { Panel } from './Panel';

type StairMode = 'any' | 'noDown' | 'noUp' | 'none';
type Mobility = Preferences['mobility'];

/** Wheelchairs and pushchairs cannot use stairs at all; routing enforces this too. */
const wheeled = (p: Preferences) => p.mobility === 'wheelchair' || p.mobility === 'stroller';

function stairMode(p: Preferences): StairMode {
  if (wheeled(p) || p.avoidStairs || (p.avoidDown && p.avoidUp)) return 'none';
  if (p.avoidDown) return 'noDown';
  if (p.avoidUp) return 'noUp';
  return 'any';
}

const stairOptions: { value: StairMode; key: MessageKey; icon: typeof ArrowDown }[] = [
  { value: 'any', key: 'prefs.stairs.any', icon: Footprints },
  { value: 'noDown', key: 'prefs.stairs.noDown', icon: ArrowDown },
  { value: 'noUp', key: 'prefs.stairs.noUp', icon: ArrowUp },
  { value: 'none', key: 'prefs.stairs.none', icon: Ban },
];

const mobilityOptions: { value: Mobility; key: MessageKey; icon: React.ComponentType<{ 'aria-hidden'?: boolean }> }[] = [
  { value: 'walk', key: 'prefs.mobility.walk', icon: Footprints },
  { value: 'crutches', key: 'prefs.mobility.crutches', icon: Crutches },
  { value: 'wheelchair', key: 'prefs.mobility.wheelchair', icon: Accessibility },
  { value: 'stroller', key: 'prefs.mobility.stroller', icon: Baby },
];

const restOptions = [0, 5, 10, 15, 20];

/** Lucide has no crutch icon; a simple drawn one keeps the same stroke style. */
function Crutches(props: { 'aria-hidden'?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4" {...props}>
      <path d="M7 3h4M9 3l-2 18M6 11h4" />
      <path d="M14 3h4M16 3l2 18M15 11h4" />
    </svg>
  );
}

const chipKey: Record<Exclude<StairMode, 'any'>, MessageKey> = { noDown: 'chip.noDown', noUp: 'chip.noUp', none: 'chip.noStairs' };

/** Today's walking distance, right in the planning card (the most changed setting). */
export function DistanceControl({ preferences, onChange }: { preferences: Preferences; onChange: (p: Preferences) => void }) {
  const { t, locale } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Footprints className="size-5 shrink-0 text-primary" aria-hidden />
      <span id="main-distance-label" className="shrink-0 text-sm text-muted-foreground">
        {t('prefs.distanceShort')}
      </span>
      <Slider
        aria-labelledby="main-distance-label"
        aria-valuetext={distance(preferences.maxDistance, locale)}
        min={100}
        max={3000}
        step={100}
        value={[preferences.maxDistance]}
        onValueChange={([v]) => onChange({ ...preferences, maxDistance: v })}
        className="min-w-0 flex-1"
      />
      <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-primary" aria-hidden>
        {distance(preferences.maxDistance, locale)}
      </span>
    </div>
  );
}

/** Compact summary of today's needs, opens the editor. */
export function PreferencesBar({ preferences, onOpen }: { preferences: Preferences; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const mode = stairMode(preferences);
  const chips = [
    preferences.mobility !== 'walk' ? t(`prefs.mobility.${preferences.mobility}`) : null,
    preferences.restEvery ? `${t('prefs.restEvery')} ${t('prefs.restMinutes', { n: preferences.restEvery })}` : null,
    mode === 'any' || wheeled(preferences) ? null : t(chipKey[mode]),
    preferences.preferHandrails && !wheeled(preferences) ? t('chip.rails') : null,
    preferences.preferRest && !preferences.restEvery ? t('chip.rest') : null,
    preferences.showToilets ? t('cat.toilet') : null,
  ].filter(Boolean) as string[];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-accent/60"
      aria-label={t('prefs.summary', { chips: chips.join(', ') })}
    >
      <SlidersHorizontal className="size-5 shrink-0 text-primary" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-hidden>
        {chips.map(chip => (
          <span key={chip} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
            {chip}
          </span>
        ))}
      </span>
      <span className="shrink-0 text-sm font-semibold text-primary" aria-hidden>
        {t('prefs.change')}
      </span>
    </button>
  );
}

const optionClass =
  'h-auto min-h-12 justify-start gap-2 whitespace-normal rounded-lg! border border-border bg-card px-3 py-2.5 text-left text-sm font-medium data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-accent-foreground';

export function PreferencesPanel({ open, onOpenChange, preferences, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preferences: Preferences;
  onChange: (p: Preferences) => void;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  function setMode(mode: StairMode) {
    onChange({ ...preferences, avoidStairs: mode === 'none', avoidDown: mode === 'noDown', avoidUp: mode === 'noUp' });
  }

  async function fromText() {
    setBusy(true);
    setNote('');
    try {
      const data = await postJson('/api/ai', { action: 'preferences', text, base: preferences, locale });
      onChange(preferencesSchema.parse(data.result.preferences));
      setNote(data.result.note || t('prefs.aiDone'));
    } catch (e) {
      toast.error(errorText(e, t('prefs.aiFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={t('prefs.title')} description={t('prefs.description')}>
      <div className="flex flex-col gap-6 pt-2">
        <section className="flex flex-col gap-3" aria-labelledby="mobility-label">
          <h3 id="mobility-label" className="font-semibold">{t('prefs.mobility')}</h3>
          <ToggleGroup
            type="single"
            value={preferences.mobility}
            onValueChange={v => {
              if (!v) return;
              const mobility = v as Mobility;
              // Accessible toilets matter most on wheels; switch them on, but keep the user's later choice.
              onChange({ ...preferences, mobility, showToilets: mobility === 'wheelchair' ? true : preferences.showToilets });
            }}
            className="grid w-full grid-cols-2 gap-2"
            aria-labelledby="mobility-label"
          >
            {mobilityOptions.map(({ value, key, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} className={optionClass}>
                <Icon aria-hidden />
                {t(key)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {preferences.mobility === 'wheelchair' ? <p className="text-sm text-muted-foreground">{t('prefs.mobilityHint')}</p> : preferences.mobility === 'stroller' ? <p className="text-sm text-muted-foreground">{t('prefs.strollerHint')}</p> : null}
        </section>

        {!wheeled(preferences) ? (
          <>
            <Separator />
            <section className="flex flex-col gap-3" aria-labelledby="stairs-label">
              <h3 id="stairs-label" className="font-semibold">{t('prefs.stairs')}</h3>
              <ToggleGroup
                type="single"
                value={stairMode(preferences)}
                onValueChange={v => v && setMode(v as StairMode)}
                className="grid w-full grid-cols-2 gap-2"
                aria-labelledby="stairs-label"
              >
                {stairOptions.map(({ value, key, icon: Icon }) => (
                  <ToggleGroupItem key={value} value={value} className={optionClass}>
                    <Icon aria-hidden />
                    {t(key)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-sm text-muted-foreground">{t('prefs.stairsHint')}</p>
            </section>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="pref-rails" className="flex items-center gap-3 text-base font-normal">
                <Grip className="size-5 text-primary" aria-hidden />
                {t('prefs.rails')}
              </Label>
              <Switch id="pref-rails" checked={preferences.preferHandrails} onCheckedChange={v => onChange({ ...preferences, preferHandrails: v })} />
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="pref-rest" className="flex items-center gap-3 text-base font-normal">
            <Armchair className="size-5 text-rest" aria-hidden />
            {t('prefs.rest')}
          </Label>
          <Switch id="pref-rest" checked={preferences.preferRest} onCheckedChange={v => onChange({ ...preferences, preferRest: v })} />
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="rest-every-label">
          <h3 id="rest-every-label" className="font-semibold">{t('prefs.restEvery')}</h3>
          <ToggleGroup
            type="single"
            value={String(preferences.restEvery)}
            onValueChange={v => v && onChange({ ...preferences, restEvery: Number(v) })}
            aria-labelledby="rest-every-label"
            className="flex w-full flex-wrap gap-1.5"
          >
            {restOptions.map(n => (
              <ToggleGroupItem key={n} value={String(n)} className="h-11 min-w-fit flex-1 rounded-lg! border bg-card px-3 text-sm data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-accent-foreground">
                {n ? t('prefs.restMinutes', { n }) : t('prefs.restOff')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {preferences.restEvery ? <p className="text-sm text-muted-foreground">{t('prefs.restHint')}</p> : null}
        </section>

        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="pref-toilets" className="flex items-center gap-3 text-base font-normal">
            <Toilet className="size-5 text-primary" aria-hidden />
            {t('prefs.toilets')}
          </Label>
          <Switch id="pref-toilets" checked={preferences.showToilets} onCheckedChange={v => onChange({ ...preferences, showToilets: v })} />
        </div>

        <Separator />

        <div className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <Label id="pref-distance-label" className="text-base font-semibold">{t('prefs.distance')}</Label>
            <span className="text-lg font-bold tabular-nums text-primary">{distance(preferences.maxDistance, locale)}</span>
          </div>
          <Slider
            aria-labelledby="pref-distance-label"
            aria-valuetext={distance(preferences.maxDistance, locale)}
            min={100}
            max={3000}
            step={100}
            value={[preferences.maxDistance]}
            onValueChange={([v]) => onChange({ ...preferences, maxDistance: v })}
          />
          <div className="flex justify-between text-sm text-muted-foreground" aria-hidden>
            <span>{distance(100, locale)}</span>
            <span>{distance(3000, locale)}</span>
          </div>
        </div>

        <Separator />

        <section className="flex flex-col gap-3" aria-labelledby="pref-ai-label">
          <h3 id="pref-ai-label" className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {t('prefs.ai')}
          </h3>
          <Textarea
            aria-labelledby="pref-ai-label"
            value={text}
            maxLength={1500}
            onChange={e => setText(e.target.value)}
            placeholder={t('prefs.aiPlaceholder')}
            className="min-h-20 text-base"
          />
          <Button variant="secondary" disabled={busy || text.trim().length < 2} onClick={fromText} className="h-11 self-start">
            {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {t('prefs.aiButton')}
          </Button>
          {note ? (
            <p role="status" className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
              {note}
            </p>
          ) : null}
        </section>

        <Button size="lg" className="h-12 text-base" onClick={() => onOpenChange(false)}>
          {t('prefs.show')}
        </Button>
      </div>
    </Panel>
  );
}
