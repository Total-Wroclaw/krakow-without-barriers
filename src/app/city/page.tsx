import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import CityDashboard from '@/components/city/CityDashboard';
import CityLogin from '@/components/city/CityLogin';
import { CITY_COOKIE, cityEnabled, verifySession } from '@/lib/city-auth';
import { cityReport, listAllReports } from '@/lib/reports-server';

export const metadata: Metadata = {
  title: 'Panel zgłoszeń — Urząd Miasta Krakowa · Każdy Krok',
  robots: { index: false, follow: false },
};

export default async function CityPage() {
  // Deployment credentials are supplied at runtime, including after the build.
  await connection();
  if (!cityEnabled()) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-lg place-content-center gap-3 p-6">
        <h1 className="text-2xl font-bold">Panel miasta jest wyłączony</h1>
        <p className="text-muted-foreground">
          Ustaw zmienną środowiskową <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">CITY_DASHBOARD_PASSWORD</code> na serwerze i uruchom aplikację ponownie.
        </p>
      </main>
    );
  }
  const token = (await cookies()).get(CITY_COOKIE)?.value;
  if (!verifySession(token)) return <CityLogin />;
  return <CityDashboard initialReports={listAllReports().map(cityReport)} />;
}
