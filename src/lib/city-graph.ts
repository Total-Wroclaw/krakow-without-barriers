// Loads the citywide OSM walking graph once per server process.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildGraph, type WalkGraph } from './routing';
import type { Dataset } from './data';

let cached: WalkGraph | undefined;

export function cityGraph(): WalkGraph {
  if (!cached) {
    const file = path.join(/* turbopackIgnore: true */ process.cwd(), 'data/krakow-city.json.gz');
    const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as Dataset;
    // The raw node table is dropped after the build; coordinates live in typed arrays.
    cached = buildGraph(data);
  }
  return cached;
}
