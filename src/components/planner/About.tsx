'use client';
import { useState } from 'react';
import { Info, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';

const sections: [MessageKey, MessageKey, string?][] = [
  ['about.mapTitle', 'about.map', 'https://www.openstreetmap.org/copyright'],
  ['about.transitTitle', 'about.transit', 'https://gtfs.ztp.krakow.pl/'],
  ['about.placesTitle', 'about.places', 'https://www.krakow.pl/getHtml?dok_id=2848'],
  ['about.reportsTitle', 'about.reports'],
  ['about.baseTitle', 'about.base', 'https://openfreemap.org'],
];

const privacyPoints: MessageKey[] = ['about.privacy.local', 'about.privacy.sent', 'about.privacy.ai', 'about.privacy.reports', 'about.privacy.none', 'about.privacy.rights'];

/** Short privacy notice (art. 13 GDPR in outline) and a way to wipe what this browser keeps. */
function Privacy() {
  const { t } = useI18n();
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  function clear() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (const key of Object.keys(store)) if (key.startsWith('krok-')) store.removeItem(key);
      } catch {}
    }
    setStep('done');
    window.setTimeout(() => window.location.reload(), 900);
  }
  return (
    <section aria-labelledby="about-privacy" className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-3">
      <h3 id="about-privacy" className="font-semibold">{t('about.privacyTitle')}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
        {privacyPoints.map(key => <li key={key}>{t(key)}</li>)}
      </ul>
      {step === 'idle' ? (
        <Button variant="outline" className="mt-1 h-11 self-start" onClick={() => setStep('confirm')}>
          <Trash2 />
          {t('about.privacy.clear')}
        </Button>
      ) : null}
      {step === 'confirm' ? (
        <div className="mt-1 flex flex-col gap-2 rounded-lg border border-barrier/40 bg-card p-3">
          <p className="font-medium">{t('about.privacy.clearConfirm')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" className="h-11" onClick={clear} autoFocus>
              <Trash2 />
              {t('about.privacy.clearYes')}
            </Button>
            <Button variant="ghost" className="h-11" onClick={() => setStep('idle')}>{t('about.privacy.clearNo')}</Button>
          </div>
        </div>
      ) : null}
      <p role="status" className="text-sm font-medium text-primary empty:hidden">{step === 'done' ? t('about.privacy.cleared') : ''}</p>
    </section>
  );
}

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
          <Privacy />
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
