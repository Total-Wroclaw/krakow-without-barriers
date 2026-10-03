'use client';
import { Ban, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cityStatusLabel, mapLinks, reportTypeLabel, statusOf, typeOf } from '@/lib/city-reports';
import type { CityStatus, Report } from '@/lib/schemas';
import { cn } from '@/lib/utils';

const dateFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export const statusClass: Record<CityStatus, string> = {
  new: 'bg-primary text-primary-foreground',
  in_review: 'bg-barrier-soft text-barrier border-barrier/30',
  forwarded: 'bg-accent text-accent-foreground border-accent-foreground/20',
  resolved: 'bg-rest-soft text-rest border-rest/30',
  rejected: 'bg-secondary text-muted-foreground border-border',
};

export function StatusBadge({ report }: { report: Report }) {
  const status = statusOf(report);
  return <Badge className={cn('border', statusClass[status])}>{cityStatusLabel[status]}</Badge>;
}

export function TypeBadge({ report }: { report: Report }) {
  return typeOf(report) === 'blocked' ? (
    <Badge className="bg-tram text-white">
      <Ban aria-hidden="true" /> {reportTypeLabel.blocked}
    </Badge>
  ) : (
    <Badge variant="outline">{reportTypeLabel.barrier}</Badge>
  );
}

export function MapLinks({ lat, lon }: { lat: number; lon: number }) {
  const links = mapLinks(lat, lon);
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={links.osm} target="_blank" rel="noreferrer">
        OpenStreetMap <ExternalLink aria-hidden="true" className="size-3.5" />
        <span className="sr-only">(otwiera się w nowej karcie)</span>
      </a>
      <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={links.google} target="_blank" rel="noreferrer">
        Google Maps <ExternalLink aria-hidden="true" className="size-3.5" />
        <span className="sr-only">(otwiera się w nowej karcie)</span>
      </a>
    </span>
  );
}
