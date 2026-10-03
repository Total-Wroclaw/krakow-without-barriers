// MapLibre v6 loads its worker relative to the bundle URL, which bundlers rewrite.
// Serve the worker and its shared chunk from /maplibre/ and point MapLibre at it.
import { copyFileSync, mkdirSync } from 'node:fs';
const from = 'node_modules/maplibre-gl/dist';
mkdirSync('public/maplibre', { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(`${from}/${file}`, `public/maplibre/${file}`);
