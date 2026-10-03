// Taxi fare estimate from the official Kraków maximum taxi prices, and ride-hailing app links.
// Pure functions: no data files, safe to import anywhere.
import { serverMessages } from './i18n/server-messages';
import type { Locale } from './i18n/locales';
import type { DriveLeg, LegPoint, RideLink } from './journey-types';

/**
 * Maximum taxi prices in Kraków, tariff zone I (the city's built-up core), gross PLN.
 * Uchwała nr XCII/2512/22 Rady Miasta Krakowa z 6 lipca 2022 r. (Dz. Urz. Woj. Małop. 2022 poz. 5009),
 * amending uchwała nr LXXVI/977/09; in force since 29 July 2022 and still listed by the city for 2026.
 * Zone II (outer districts, tariffs 3–4: 8 / 12 zł per km) is not modelled: we have no zone polygon.
 */
export const KRAKOW_TAXI_TARIFF = {
  /** Initial fee including the first stretch of at least 200 m. */
  initialFee: 9,
  includedKm: 0.2,
  /** Tariff 1: weekdays 6:00–22:00. */
  perKmTariff1: 4,
  /** Tariff 2: weekdays 22:00–6:00, Sundays and public holidays. */
  perKmTariff2: 6,
  /** Waiting (postój), per hour. */
  waitingPerHour: 55,
  /** Upper bound allowance for slow traffic (waiting time is charged on top of distance). */
  trafficAllowance: 0.2,
  sourceUrl: 'https://www.bip.krakow.pl/zalaczniki/dokumenty/n/343506',
  resolution: 'XCII/2512/22',
} as const;

/** Price at a tariff for a distance in metres, by the city's formula (initial fee covers the first 200 m). */
export function tariffPrice(metres: number, perKm: number) {
  const t = KRAKOW_TAXI_TARIFF;
  return t.initialFee + Math.max(0, metres / 1000 - t.includedKm) * perKm;
}

/**
 * Fare range for a taxi ride: min = tariff 1 for the estimated distance, max = tariff 2 plus 20 % for
 * traffic. An estimate of the legal maximum price, not a quote (apps may price differently).
 */
export function taxiFare(metres: number, locale: Locale = 'pl'): NonNullable<DriveLeg['fare']> {
  const t = KRAKOW_TAXI_TARIFF;
  return {
    min: Math.floor(tariffPrice(metres, t.perKmTariff1)),
    max: Math.ceil(tariffPrice(metres, t.perKmTariff2) * (1 + t.trafficAllowance)),
    currency: 'PLN',
    basis: serverMessages(locale).fare.basis,
    sourceUrl: t.sourceUrl,
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Uber: documented universal link (developer.uber.com, "Deep Links") with pickup and drop-off as JSON.
 * Bolt and FreeNow publish no coordinate deep links, so their links open the official Kraków pages.
 */
export function rideLinks(from: LegPoint, to: LegPoint, locale: Locale = 'pl'): RideLink[] {
  const place = (p: LegPoint) => encodeURIComponent(JSON.stringify({ latitude: round6(p.lat), longitude: round6(p.lon), addressLine1: p.name }));
  return [
    { provider: 'uber', url: `https://m.uber.com/looking?pickup=${place(from)}&drop[0]=${place(to)}` },
    { provider: 'bolt', url: locale === 'pl' ? 'https://bolt.eu/pl-pl/cities/krakow/' : 'https://bolt.eu/en/cities/krakow/' },
    { provider: 'freenow', url: 'https://www.free-now.com/pl/pasazer/taxi-krakowie/' },
  ];
}
