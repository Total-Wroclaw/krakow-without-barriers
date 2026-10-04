# Każdy Krok — production image.
# Data snapshots (OSM graphs, places, roads, parking, UMK venues) are versioned in data/.
# The ZTP timetable (~320 MB SQLite) is downloaded and normalised at build time.
# Reports, photos and tile/aerial caches live in KROK_STORAGE_DIR (mount a volume there).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/copy-maplibre-worker.mjs scripts/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM python:3.13-slim AS transit
WORKDIR /app
COPY scripts/acquire-transit.py scripts/
RUN mkdir -p data && python3 scripts/acquire-transit.py && mkdir -p /transit && mv .runtime/transit.sqlite /transit/

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    KROK_STORAGE_DIR=/data \
    KROK_TRANSIT_DB=/app/transit/transit.sqlite \
    NODE_OPTIONS=--max-old-space-size=3072
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/data ./data
COPY --from=transit /transit/transit.sqlite ./transit/transit.sqlite
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# Answers 200 whenever the server is up; stale data shows as "degraded" in the body, not as a failure.
# A short interval matters: the proxy routes to a new container only once it reports healthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
