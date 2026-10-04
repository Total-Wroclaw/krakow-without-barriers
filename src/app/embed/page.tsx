import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { MapPinOff } from 'lucide-react';
import Planner from '@/components/planner/Planner';
import { placeSchema } from '@/lib/city-types';
import { isLocale } from '@/lib/i18n/locales';
import { acceptLanguage } from '@/lib/i18n/request-locale';
import { serverMessages } from '@/lib/i18n/server-messages';
import { I18nProvider } from '@/lib/i18n/client';

export const metadata: Metadata = { title: 'Jak do nas dotrzeć — Każdy Krok', robots: { index: false } };

/** "How to reach us" widget for partner websites: /embed?to=lat,lon&name=…[&locale=pl|en|de] */
export default async function EmbedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const requested = String(params.locale ?? params.lang ?? '');
  const locale = isLocale(requested) ? requested : (acceptLanguage((await headers()).get('accept-language')) ?? 'pl');
  const m = serverMessages(locale).api.embed;
  const [lat, lon] = String(params.to ?? '').split(',').map(Number);
  const name = String(params.name ?? '').slice(0, 120) || m.fallbackName;
  const place = placeSchema.safeParse({ id: `point:${lat}:${lon}`, name, lat, lon, source: 'embed' });
  if (!place.success) {
    return (
      <main lang={locale} className="flex min-h-dvh items-center justify-center p-6">
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 text-center">
          <MapPinOff aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="text-base font-semibold">{m.invalid}</p>
          <p className="text-sm text-muted-foreground">{m.hint}</p>
          <a href="/" target="_blank" rel="noopener" className="text-sm font-medium text-primary underline underline-offset-4">
            {m.openApp}
          </a>
        </div>
      </main>
    );
  }
  return <I18nProvider initialLocale={locale}><Planner embed={place.data} /></I18nProvider>;
}
