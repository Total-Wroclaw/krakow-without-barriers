// Warm-up after a (re)start: the first route request otherwise pays for loading the walking graph and the
// timetable (~7 s in production). register() must return before the server serves requests, so it only starts
// a background task that waits for the server and sends it one ordinary request per heavy area.
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production' || process.env.KROK_NO_WARMUP) return;
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  void (async () => {
    for (let i = 0; i < 120; i++) {
      const up = await fetch(`${base}/api/health`).then(r => r.ok, () => false);
      if (up) break;
      await wait(1000);
    }
    const now = new Date(Date.now() + 3_600_000);
    const date = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
    const time = now.toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
    const place = (name: string, lat: number, lon: number) => ({ id: `warmup:${name}`, name, lat, lon, source: 'search' });
    const preferences = { avoidStairs: true, avoidDown: true, avoidUp: false, preferHandrails: true, preferRest: true, maxDistance: 1200, mobility: 'walk', restEvery: 0, showToilets: false };
    const requests: [string, RequestInit?][] = [
      ['/api/journey', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ from: place('Dworzec Główny', 50.06714, 19.94566), to: place('Wawel', 50.05411, 19.93541), preferences, date, time, transport: 'transit', locale: 'pl' }) }],
      ['/api/places?q=Wawel'],
      ['/api/objects?locale=pl'],
    ];
    for (const [url, init] of requests) await fetch(base + url, init).catch(() => {});
  })();
}
