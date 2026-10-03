// Download and parse the UMK accessibility list of city buildings, geocode addresses with the local OSM address index,
// and save data/krakow-city-venues.json atomically.
// Usage: npm run data:city-venues            (download)
//        npx tsx scripts/acquire-city-venues.ts --file saved.html   (parse a saved copy; obtainedAt = now, URL unchanged)
// Outage behaviour: if the page cannot be fetched or its structure is not recognised, the previous file is kept
// unchanged and the script exits with code 1 (so a scheduled job reports the failure instead of publishing empty data).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { searchPlaces, fold } from '../src/lib/places';
import { addressQuery, parseUmkHtml, UMK_SOURCE_URL, venueSlug, type CityVenue, type CityVenuesFile, type ParsedVenue } from '../src/lib/city-venues';

const OUT = path.join(process.cwd(), 'data/krakow-city-venues.json');

async function download(): Promise<string> {
  const response = await fetch(UMK_SOURCE_URL, { headers: { 'User-Agent': 'KazdyKrok/0.1 (HackYeah 2026 prototype; accessibility data import)' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

/** Exact house-number match in Kraków only; ranges like "3-4" fall back to the first number. Never guesses. */
function geocode(venue: ParsedVenue): Pick<CityVenue, 'lat' | 'lon' | 'geocode'> {
  const query = addressQuery(venue.address);
  const number = query.match(/(\d+[a-z]?)(?:-\d+)?$/i);
  if (!number) return { lat: null, lon: null, geocode: { status: 'unresolved', reason: 'Brak numeru budynku w adresie' } };
  const variants = [query, query.replace(/-\d+$/, '')].filter((v, i, a) => a.indexOf(v) === i);
  for (const variant of variants) {
    const wanted = fold(variant.match(/(\d+[a-z]?)$/i)![1]);
    const hit = searchPlaces(variant, undefined, 8).find(p => p.kind === 'address' && fold(p.name).endsWith(` ${wanted}`) && /Kraków$/.test(p.detail ?? ''));
    if (hit) return { lat: hit.lat, lon: hit.lon, geocode: { status: 'resolved', match: `${hit.name}, ${hit.detail}`, osmRef: hit.id } };
  }
  return { lat: null, lon: null, geocode: { status: 'unresolved', reason: `Adresu „${venue.address}” nie ma w lokalnym indeksie adresów OSM` } };
}

async function main() {
  const fileArg = process.argv.indexOf('--file');
  let html: string;
  try {
    html = fileArg > 0 ? readFileSync(process.argv[fileArg + 1], 'utf8') : await download();
  } catch (error) {
    console.error(`UMK page unavailable (${(error as Error).message}); keeping ${existsSync(OUT) ? 'previous file' : 'no file'} unchanged.`);
    process.exit(1);
  }
  let parsed: ParsedVenue[];
  try { parsed = parseUmkHtml(html); } catch (error) {
    console.error(`${(error as Error).message}; keeping previous file unchanged.`);
    process.exit(1);
  }
  const seen = new Map<string, number>();
  const venues: CityVenue[] = parsed.map(v => {
    let id = venueSlug(v.name); const n = (seen.get(id) ?? 0) + 1; seen.set(id, n); if (n > 1) id += `-${n}`;
    return { id, ...v, ...geocode(v) };
  });
  const result: CityVenuesFile = {
    v: 1,
    source: { url: UMK_SOURCE_URL, title: 'Dostępność budynków Urzędu Miasta Krakowa i Miejskich Jednostek Organizacyjnych', obtainedAt: new Date().toISOString(), sha256: createHash('sha256').update(html).digest('hex'), publisher: 'Urząd Miasta Krakowa' },
    venues,
    unresolved: venues.filter(v => v.geocode.status === 'unresolved').map(v => `${v.name} — ${v.address}`),
  };
  const temp = `${OUT}.tmp`;
  writeFileSync(temp, JSON.stringify(result, null, 1) + '\n');
  renameSync(temp, OUT);
  console.log(JSON.stringify({ venues: venues.length, geocoded: venues.length - result.unresolved.length, unresolved: result.unresolved, unmappedPhrases: venues.flatMap(v => v.unmapped) }));
}
main();
