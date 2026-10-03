'use client';
import { useState } from 'react';
import { Accessibility, Armchair, ArrowDown, ArrowUp, Baby, Ban, Footprints, Grip, LoaderCircle, SlidersHorizontal, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { postJson } from '@/lib/client';
import { distance } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { preferencesSchema, type Preferences } from '@/lib/schemas';
import { Panel } from './Panel';

type StairMode = 'any' | 'noDown' | 'noUp' | 'none';
type Mobility = Preferences['mobility'];

/** Wheelchairs and pushchairs cannot use stairs at all; routing enforces this too. */
const wheeled = (p: Preferences) => p.mobility !== 'walk';

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

const mobilityOptions: { value: Mobility; key: MessageKey; icon: typeof Footprints }[] = [
  { value: 'walk', key: 'prefs.mobility.walk', icon: Footprints },
  { value: 'wheelchair', key: 'prefs.mobility.wheelchair', icon: Accessibility },
  { value: 'stroller', key: 'prefs.mobility.stroller', icon: Baby },
];

const chipKey: Record<Exclude<StairMode, 'any'>, MessageKey> = { noDown: 'chip.noDown', noUp: 'chip.noUp', none: 'chip.noStairs' };

/** Compact summary of today's needs, opens the editor. */
export function PreferencesBar({ preferences, onOpen }: { preferences: Preferences; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const mode = stairMode(preferences);
  const chips = [
    preferences.mobility !== 'walk' ? t(`prefs.mobility.${preferences.mobility}`) : null,
    mode === 'any' || wheeled(preferences) ? null : t(chipKey[mode]),
    preferences.preferHandrails && !wheeled(preferences) ? t('chip.rails') : null,
    preferences.preferRest ? t('chip.rest') : null,
    t('chip.distance', { distance: distance(preferences.maxDistance, locale) }),
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
  'h-auto min-h-12 justify-start gap-2 rounded-lg! border border-border bg-card px-3 py-2.5 text-left text-sm font-medium data-[state=on]:border-primary data-[state=on]:bg-accent data-[state=on]:text-accent-foreground';

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
      toast.error(e instanceof Error ? e.message : t('prefs.aiFailed'));
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
            onValueChange={v => v && onChange({ ...preferences, mobility: v as Mobility })}
            className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
            aria-labelledby="mobility-label"
          >
            {mobilityOptions.map(({ value, key, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} className={optionClass}>
                <Icon aria-hidden />
                {t(key)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {wheeled(preferences) ? <p className="text-sm text-muted-foreground">{t('prefs.mobilityHint')}</p> : null}
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
