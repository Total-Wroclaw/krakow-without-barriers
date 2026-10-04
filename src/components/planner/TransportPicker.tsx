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
  // Layout follows the picker's own width (the desktop panel is narrow), not the screen width:
  // a 2×2 grid of icon + label on the narrowest phones, one row of icon-over-label columns sized to
  // their labels from 18rem, and icon beside label once there is plenty of room.
  return (
    <div className="@container">
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={v => v && onChange(v as TransportMode)}
      aria-label={t('transport.label')}
      className="grid w-full grid-cols-2 gap-1 @[18rem]:grid-cols-[repeat(4,auto)]"
    >
      {modes.map(({ value: mode, icon: Icon, key }) => (
        <ToggleGroupItem
          key={mode}
          value={mode}
          className="h-auto min-h-11 min-w-0 gap-1.5 rounded-lg! px-1.5 py-1.5 text-sm leading-tight whitespace-normal data-[state=on]:bg-accent data-[state=on]:text-accent-foreground @[18rem]:min-h-12 @[18rem]:flex-col @[18rem]:gap-0.5 @[18rem]:text-xs @xl:flex-row @xl:gap-1.5 @xl:text-sm"
        >
          <Icon aria-hidden />
          <span className="min-w-0 text-center break-words">{t(key)}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
    </div>
  );
}
