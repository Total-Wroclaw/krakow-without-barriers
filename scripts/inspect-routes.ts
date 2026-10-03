// Prints journey options and timings for sample queries: npx tsx scripts/inspect-routes.ts [YYYY-MM-DD] [HH:MM]
import { cityGraph } from '../src/lib/city-graph';
import { planJourney } from '../src/lib/journey';
import { defaultPreferences } from '../src/lib/schemas';
import { gtfsTime } from '../src/lib/transit-scan';
import type { CityPlace } from '../src/lib/city-types';

const place = (id: string, name: string, lat: number, lon: number): CityPlace => ({ id, name, lat, lon, source: 'inspect' });
const dworzec = place('dworzec', 'Dworzec Główny', 50.06583, 19.94756);
const centralny = place('centralny', 'Plac Centralny', 50.07207, 20.03764);
const rynek = place('rynek', 'Rynek Główny', 50.06168, 19.93731);
const wawel = place('wawel', 'Wawel', 50.05409, 19.93541);
const kazimierz = place('kazimierz', 'Plac Nowy', 50.05165, 19.94471);
const bronowice = place('bronowice', 'Bronowice Małe', 50.08143, 19.88104);

const date = process.argv[2] ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
const time = process.argv[3] ?? '14:00';

let started = performance.now();
cityGraph();
console.log(`graph load: ${Math.round(performance.now() - started)} ms (cold start, once per process)`);

for (const [from, to] of [[dworzec, centralny], [rynek, wawel], [centralny, dworzec], [kazimierz, bronowice]]) {
  started = performance.now();
  const result = planJourney({ from, to, preferences: defaultPreferences, date, time });
  const ms = Math.round(performance.now() - started);
  console.log(`\n${from.name} → ${to.name} @ ${date} ${time}: ${ms} ms, ${result.options.length} options${result.errors.length ? `, errors: ${result.errors.join(' / ')}` : ''}`);
  for (const o of result.options) {
    const times = o.departure !== null && o.arrival !== null ? `${gtfsTime(o.departure)}–${gtfsTime(o.arrival)}` : '';
    const legs = o.legs.map(l => (l.type === 'walk' ? `pieszo ${l.distance} m` : l.type === 'drive' ? `${l.mode} ${l.distance} m${l.parking ? ` → ${l.parking.name}` : ''}` : `${l.line} ${l.from.name}→${l.to.name}`)).join(' | ');
    console.log(`  [${o.kind}] ${o.label} ${times} ${Math.round(o.duration / 60)} min, walk ${o.walkingDistance} m, stairs ${JSON.stringify(o.stairs)}, rests ${o.rests}, fits ${o.fits}${o.issues.length ? ` (${o.issues.join('; ')})` : ''}`);
    console.log(`      ${legs}`);
  }
}
