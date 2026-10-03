import type { Metadata } from 'next';
import Planner from '@/components/planner/Planner';
import { placeSchema } from '@/lib/city-types';

export const metadata: Metadata = { title: 'Jak do nas dotrzeć — Każdy Krok', robots: { index: false } };

/** "How to reach us" widget for partner websites: /embed?to=lat,lon&name=… */
export default async function EmbedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const [lat, lon] = String(params.to ?? '').split(',').map(Number);
  const name = String(params.name ?? '').slice(0, 120) || 'Cel';
  const place = placeSchema.safeParse({ id: `point:${lat}:${lon}`, name, lat, lon, source: 'embed' });
  if (!place.success) {
    return <p className="p-6">Nieprawidłowy adres widżetu. Użyj /embed?to=50.0614,19.9366&amp;name=Nazwa</p>;
  }
  return <Planner embed={place.data} />;
}
