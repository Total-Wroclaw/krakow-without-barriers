'use client';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

const sections: [MessageKey, MessageKey, string?][] = [
  ['about.mapTitle', 'about.map', 'https://www.openstreetmap.org/copyright'],
  ['about.transitTitle', 'about.transit', 'https://gtfs.ztp.krakow.pl/'],
  ['about.placesTitle', 'about.places', 'https://www.krakow.pl/getHtml?dok_id=2848'],
  ['about.reportsTitle', 'about.reports'],
  ['about.privacyTitle', 'about.privacy'],
  ['about.baseTitle', 'about.base', 'https://openfreemap.org'],
];

export function About() {
  const { t } = useI18n();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" className="h-11 gap-1.5 px-2.5 text-muted-foreground" aria-label={t('about.button')}>
          <Info />
          <span className="hidden sm:inline">{t('about.button')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{t('about.title')}</DialogTitle>
          <DialogDescription>{t('about.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm leading-relaxed">
          {sections.map(([title, body, url]) => (
            <section key={title}>
              <h3 className="font-semibold">
                {url ? (
                  <a className="text-primary underline underline-offset-2" href={url} target="_blank" rel="noreferrer">
                    {t(title)}
                  </a>
                ) : (
                  t(title)
                )}
              </h3>
              <p className="text-muted-foreground">{t(body)}</p>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
