'use client';
import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { warsawNow } from '@/lib/format';
import { useI18n } from '@/lib/i18n/client';

export type When = { mode: 'now' } | { mode: 'at'; date: string; time: string };

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TimeChooser({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const now = warsawNow();
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [time, setTime] = useState(value.mode === 'at' ? value.time : now.time);
  const label = value.mode === 'now' ? t('time.now') : t('time.at', { day: t(value.date === now.date ? 'time.today' : 'time.tomorrow'), time: value.time });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-11 w-full justify-start gap-3 rounded-xl px-3 text-left font-medium whitespace-normal" aria-label={t('time.change', { label })}>
          <Clock className="size-5 text-primary" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-4">
        <Button variant={value.mode === 'now' ? 'default' : 'outline'} className="h-11" onClick={() => { onChange({ mode: 'now' }); setOpen(false); }}>
          {t('time.now')}
        </Button>
        <div className="flex flex-col gap-3">
          <ToggleGroup type="single" value={day} onValueChange={v => v && setDay(v as 'today' | 'tomorrow')} className="grid w-full grid-cols-2 rounded-lg border p-0.5" aria-label={t('time.day')}>
            <ToggleGroupItem value="today" className="h-10">{t('time.todayCap')}</ToggleGroupItem>
            <ToggleGroupItem value="tomorrow" className="h-10">{t('time.tomorrowCap')}</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trip-time">{t('time.hour')}</Label>
            <Input id="trip-time" type="time" value={time} onChange={e => setTime(e.target.value)} className="h-11 text-base" />
          </div>
          {day === 'today' && /^\d\d:\d\d$/.test(time) && time < now.time ? (
            <p className="text-sm font-medium text-barrier" role="status">{t('time.past')}</p>
          ) : null}
          <Button
            className="h-11"
            disabled={!/^\d\d:\d\d$/.test(time)}
            onClick={() => {
              onChange({ mode: 'at', date: day === 'today' ? now.date : addDays(now.date, 1), time });
              setOpen(false);
            }}
          >
            {t('time.set')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
