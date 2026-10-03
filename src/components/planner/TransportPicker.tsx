'use client';
import { CarFront, CarTaxiFront, Footprints, TramFront } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useI18n } from '@/lib/i18n/client';
import type { TransportMode } from '@/lib/journey-types';

const modes: { value: TransportMode; icon: typeof TramFront; key: 'transport.walk' | 'transport.transit' | 'transport.taxi' | 'transport.car' }[] = [
  { value: 'walk', icon: Footprints, key: 'transport.walk' },
  { value: 'transit', icon: TramFront, key: 'transport.transit' },
  { value: 'taxi', icon: CarTaxiFront, key: 'transport.taxi' },
  { value: 'car', icon: CarFront, key: 'transport.car' },
];

export function TransportPicker({ value, onChange }: { value: TransportMode; onChange: (m: TransportMode) => void }) {
  const { t } = useI18n();
  // Layout follows the picker's own width (the desktop panel is narrow), not the screen width.
  return (
    <div className="@container">
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as TransportMode)}
      aria-label={t('transport.label')}
      className="grid w-full grid-cols-4 gap-1"
    >
      {modes.map(({ value: mode, icon: Icon, key }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          className="h-auto min-h-12 min-w-0 flex-col gap-0.5 rounded-lg! px-1 py-1.5 text-xs leading-tight data-[state=on]:bg-accent data-[state=on]:text-accent-foreground @xl:flex-row @xl:gap-1.5 @xl:text-sm"
        >
          <Icon aria-hidden />
          <span className="max-w-full text-center break-words">{t(key)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    </div>
  );
}
