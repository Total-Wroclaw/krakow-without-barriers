'use client';
import { CarFront, CarTaxiFront, TramFront } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '@/lib/i18n/client';
import type { TransportMode } from '@/lib/journey-types';

const modes: { value: TransportMode; icon: typeof TramFront; key: 'transport.transit' | 'transport.taxi' | 'transport.car' }[] = [
  { value: 'transit', icon: TramFront, key: 'transport.transit' },
  { value: 'taxi', icon: CarTaxiFront, key: 'transport.taxi' },
  { value: 'car', icon: CarFront, key: 'transport.car' },
];

export function TransportPicker({ value, onChange }: { value: TransportMode; onChange: (m: TransportMode) => void }) {
  const { t } = useI18n();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as TransportMode)}
      aria-label={t('transport.label')}
      className="grid w-full grid-cols-3 gap-1"
    >
      {modes.map(({ value: mode, icon: Icon, key }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          className="h-11 gap-1 rounded-lg! px-1.5 text-sm data-[state=on]:bg-accent data-[state=on]:text-accent-foreground"
        >
          <Icon aria-hidden />
          <span className="truncate">{t(key)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
