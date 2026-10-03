'use client';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n/client';
import { isLocale, localeNames, locales } from '@/lib/i18n/locales';

export function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-11 gap-1.5 px-2.5 text-muted-foreground" aria-label={`${t('app.language')}: ${localeNames[locale]}`}>
          <Languages />
          <span className="uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t('app.language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={v => isLocale(v) && setLocale(v)}>
          {locales.map(l => (
            <DropdownMenuRadioItem key={l} value={l} lang={l} className="min-h-10">
              {localeNames[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
