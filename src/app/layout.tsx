import type { Metadata, Viewport } from 'next';
import { Atkinson_Hyperlegible_Next } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { I18nProvider } from '@/lib/i18n/client';
import './globals.css';

const atkinson = Atkinson_Hyperlegible_Next({ subsets: ['latin', 'latin-ext'], variable: '--font-atkinson', display: 'swap', adjustFontFallback: false });

export const metadata: Metadata = {
  title: 'Każdy Krok — trasy po Krakowie na dziś',
  description: 'Zaplanuj dojście i przejazd po Krakowie z uwzględnieniem schodów, poręczy i miejsc odpoczynku. Odkrywaj muzea i zabytki z konkretnymi informacjami o dostępności.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Każdy Krok', statusBarStyle: 'default' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#2443b0' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={atkinson.variable}>
      <body className="font-sans">
        <I18nProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
        <Toaster position="top-center" theme="light" closeButton />
      </body>
    </html>
  );
}
