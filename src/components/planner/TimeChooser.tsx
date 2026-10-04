'use client';
import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { warsawNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';
import { addDays, departureDay, validDeparture, type When } from '@/lib/trip-sharing';

export function TimeChooser({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const now = warsawNow();
  const [date, setDate] = useState(value.mode === 'at' ? value.date : now.date);
  const [time, setTime] = useState(value.mode === 'at' ? value.time : now.time);
  const tomorrow = addDays(now.date, 1);
  const day = date === now.date ? 'today' : date === tomorrow ? 'tomorrow' : '';
  const valid = validDeparture(date, time);
  const past = valid && `${date}T${time}` < `${now.date}T${now.time}`;
  const label = value.mode === 'now' ? t('time.now') : t('time.at', {
    day: departureDay(value.date, now.date, locale, { today: t('time.today'), tomorrow: t('time.tomorrow') }),
    time: value.time,
  });

  return (
    <Popover open={open} onOpenChange={next => {
      if (next) {
        // Reopening edits the applied departure, including a date restored from a shared link.
        const departure = value.mode === 'at' ? value : warsawNow();
        setDate(departure.date);
        setTime(departure.time);
      }
      setOpen(next);
    }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-left font-medium whitespace-normal" aria-label={t('time.change', { label })}>
          <Clock className="size-5 text-primary" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[var(--radix-popover-content-available-height)] w-72 flex-col gap-4 overflow-y-auto">
        <Button variant={value.mode === 'now' ? 'default' : 'outline'} className="h-11" onClick={() => { onChange({ mode: 'now' }); setOpen(false); }}>
          {t('time.now')}
        </Button>
        <FieldGroup className="min-w-0 gap-3">
          <ToggleGroup type="single" value={day} onValueChange={v => v && setDate(v === 'today' ? now.date : tomorrow)} className="grid w-full grid-cols-2 rounded-lg border p-0.5" aria-label={t('time.day')}>
            <ToggleGroupItem value="today" className="h-11">{t('time.todayCap')}</ToggleGroupItem>
            <ToggleGroupItem value="tomorrow" className="h-11">{t('time.tomorrowCap')}</ToggleGroupItem>
          </ToggleGroup>
          <Field className="min-w-0 gap-1.5">
            <FieldLabel htmlFor="trip-date">{t('time.date')}</FieldLabel>
            <Input id="trip-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="h-11 max-w-full appearance-none text-base" />
          </Field>
          <Field className="min-w-0 gap-1.5">
            <FieldLabel htmlFor="trip-time">{t('time.hour')}</FieldLabel>
            <Input id="trip-time" type="time" value={time} onChange={e => setTime(e.target.value)} className="h-11 max-w-full appearance-none text-base" />
          </Field>
          {past ? (
            <p className="text-sm font-medium text-barrier" role="status">{t('time.past')}</p>
          ) : null}
          <Button
            className="h-11"
            disabled={!valid}
            onClick={() => {
              onChange({ mode: 'at', date, time });
              setOpen(false);
            }}
          >
            {t('time.set')}
          </Button>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
