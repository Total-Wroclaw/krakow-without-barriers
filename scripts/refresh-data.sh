#!/usr/bin/env bash
# Refreshes the versioned data snapshots in data/ from their public sources.
# Each source is independent: if one fails, its previous snapshot stays in place (every script writes
# to a temporary file and swaps it in atomically), the others still refresh, and the exit code says
# which failed. The ZTP timetable is not here: it is downloaded when the container image is built.
#
# Usage: PYTHON=/path/to/python-with-osmium scripts/refresh-data.sh [path/to/malopolskie.osm.pbf]
set -u
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
PBF="${1:-${TMPDIR:-/tmp}/krok-malopolskie.osm.pbf}"
GEOFABRIK="https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf"
failed=()

if [ ! -s "$PBF" ] || [ -n "$(find "$PBF" -mtime +1 2>/dev/null)" ]; then
  echo "Downloading OSM extract (Geofabrik, Małopolska)…"
  if curl -fsSL --retry 3 -o "$PBF.part" "$GEOFABRIK"; then mv "$PBF.part" "$PBF"; else rm -f "$PBF.part"; failed+=("osm-download"); fi
fi

if [ -s "$PBF" ]; then
  for step in city places roads objects; do
    echo "OSM → $step"
    "$PYTHON" "scripts/acquire-$step.py" "$PBF" || failed+=("$step")
  done
else
  failed+=("city" "places" "roads" "objects")
fi

echo "UMK venue list"
npx tsx scripts/acquire-city-venues.ts || failed+=("city-venues")

if [ ${#failed[@]} -gt 0 ]; then
  echo "Kept previous snapshots for: ${failed[*]}" >&2
  exit 1
fi
echo "All snapshots refreshed."
