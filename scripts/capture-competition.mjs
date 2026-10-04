// Competition material capture: crisp screenshots (phone + desktop) and the scripted demo recording.
//
//   node scripts/capture-competition.mjs shots [baseUrl]   → artifacts/competition/assets/{phone,desktop}-*.png
//   node scripts/capture-competition.mjs video [baseUrl]   → artifacts/competition/video/raw/*.webm + timeline.json
//   node scripts/capture-competition.mjs all   [baseUrl]
//
// baseUrl defaults to http://localhost:3030 (a running dev or production server; this script never starts one).
// Optional: ONLY=routes,place (scene names), CITY_URL + CITY_PASSWORD for the /city dashboard (a server started with
// CITY_DASHBOARD_PASSWORD; the scene seeds a few clearly-labelled sample reports there if it is empty — point it at a
// scratch instance with its own KROK_STORAGE_DIR, never at production). The report scene creates one photo report
// through the UI and deletes it again with its author token, so the target's report store ends unchanged.
// Video assembly (captions, title/end cards, ffmpeg): scripts/competition-video.mjs.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [mode = 'shots', baseArg] = process.argv.slice(2);
const BASE = (baseArg ?? 'http://localhost:3030').replace(/\/$/, '');
const CITY_URL = process.env.CITY_URL?.replace(/\/$/, '');
const CITY_PASSWORD = process.env.CITY_PASSWORD;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ASSETS = path.join(ROOT, 'artifacts/competition/assets');
const RAW = path.join(ROOT, 'artifacts/competition/video/raw');

// A weekday late morning, so the timetable looks like a normal day whenever the script runs.
const DATE = nextWeekday();
const TIME = '10:00';
const DWORZEC = '50.06714%2C19.94566%2CDworzec%20G%C5%82%C3%B3wny';
const WAWEL = '50.05411%2C19.93541%2CWawel';
const trip = (from, to, extra = '') => `${BASE}/?from=${from}&to=${to}&date=${DATE}&time=${TIME}${extra}`;

/** Persona for the story: on crutches after a knee operation; stairs down hurt, up is fine. Needs, not diagnosis. */
const PERSONA = { avoidStairs: false, avoidDown: true, avoidUp: false, preferHandrails: true, preferRest: true, maxDistance: 1500, mobility: 'crutches', restEvery: 10, showToilets: true };
/** Wheelchair profile for the lift scene. */
const WHEELCHAIR = { ...PERSONA, avoidStairs: true, avoidDown: true, avoidUp: true, mobility: 'wheelchair' };
const NEEDS_TEXT = 'Chodzę dziś o kulach. Schodzenie po schodach boli, pod górę dam radę. Chcę odpocząć co 10 minut i mieć przystosowaną toaletę po drodze.';

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
};

function nextWeekday() {
  const d = new Date(Date.now() + 864e5);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const HIDE_DEV = 'nextjs-portal{display:none!important}';
async function context(browser, device, { prefs = PERSONA, video = null, geo = { latitude: 50.05436, longitude: 19.93518 } } = {}) {
  const ctx = await browser.newContext({
    ...DEVICES[device], locale: 'pl-PL', timezoneId: 'Europe/Warsaw',
    geolocation: { ...geo, accuracy: 15 }, permissions: ['geolocation'],
    ...(video ? { recordVideo: { dir: video.dir, size: video.size } } : {}),
  });
  await ctx.addInitScript(([p, css]) => {
    try {
      if (p) localStorage.setItem('krok-preferences-v1', JSON.stringify(p));
      localStorage.removeItem('krok-locale-v1');
    } catch {}
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  }, [prefs, HIDE_DEV]);
  return ctx;
}

// ---------- shared waits and helpers ----------
const routesHeading = p => p.getByRole('heading', { name: /^Trasy \(\d+\)/ });
async function waitRoutes(p) {
  await routesHeading(p).waitFor({ timeout: 90_000 });
  await settleMap(p);
}
/** MapLibre has drawn and tiles are in: wait for network quiet, then one more frame. */
async function settleMap(p, extra = 600) {
  await p.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.waitForTimeout(extra);
}
const isPhone = p => (p.viewportSize()?.width ?? 1440) < 1024;
async function sheet(p, snap) {
  if (!isPhone(p)) return;
  // The handle steps peek → half → full → peek.
  for (let i = 0; i < 3; i++) {
    const h = await p.evaluate(() => document.querySelector('.app-shell [style*="--sheet"]')?.getBoundingClientRect().height ?? 0);
    const vh = p.viewportSize().height;
    const now = h < 160 ? 'peek' : h > vh - 120 ? 'full' : 'half';
    if (now === snap) return;
    await p.getByRole('button', { name: /^(Rozwiń|Zwiń) panel$/ }).click();
    await p.waitForTimeout(450);
  }
}
/** Scroll the planner panel (the scroll container holding `locator`) so `locator` sits near the top. */
async function scrollPanelTo(p, locator, offset = 12) {
  await locator.first().evaluate((el, off) => {
    let s = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (!s) return el.scrollIntoView({ block: 'start' });
    s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - off;
  }, offset);
  await p.waitForTimeout(350);
}
async function openPreferences(p) {
  await p.getByRole('button', { name: /Twoje potrzeby na dziś/ }).first().click();
  await p.getByRole('heading', { name: 'Jak idziesz dzisiaj?' }).waitFor();
  await p.waitForTimeout(400);
}
/** Wait for `name` in the Explore list; widen to the whole city when the visible map area has no match. */
async function findInList(p, name) {
  const hit = p.getByRole('button', { name: new RegExp(name) }).first();
  const citywide = p.getByRole('button', { name: 'Szukaj w całym Krakowie' });
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (await hit.isVisible()) return hit;
    if (await citywide.isVisible()) await citywide.click();
    await p.waitForTimeout(300);
  }
  throw new Error(`"${name}" not found in Explore`);
}
async function openExplorePlace(p, query, name) {
  await p.getByRole('tab', { name: 'Odkrywaj' }).click();
  const search = p.getByPlaceholder('Muzeum, zabytek, toaleta…');
  await search.fill(query);
  const hit = await findInList(p, name);
  await p.waitForTimeout(400);
  await hit.click();
  await p.getByRole('heading', { name: new RegExp(`^${name}`) }).first().waitFor({ timeout: 20_000 });
}
/** Pick the test photo: tap the photo option, accept the one-time notice if the app shows it, feed the file chooser. */
async function choosePhoto(p, press, readNotice = 0) {
  let picked = null;
  const chooser = p.waitForEvent('filechooser', { timeout: 60_000 }).then(c => (picked = c));
  await press(p.getByText('Zrób zdjęcie przeszkody'));
  const notice = p.getByRole('button', { name: /Rozumiem, zrób zdjęcie/ });
  const until = Date.now() + 60_000;
  while (!picked && Date.now() < until) {
    if (await notice.isVisible().catch(() => false)) {
      if (readNotice) await p.waitForTimeout(readNotice);
      await press(notice);
    }
    await p.waitForTimeout(200);
  }
  await (await chooser).setFiles({ name: 'schody-test.jpg', mimeType: 'image/jpeg', buffer: await testPhoto() });
}
/** Bird's-eye reading: advice streamed first, then observations confirmed on close-ups. */
async function waitAerial(p) {
  await p.getByRole('heading', { name: 'Jak dojść i wejść' }).waitFor({ timeout: 60_000 });
  // Done when no progress line is left: image, advice ("Czytamy okolicę"), close-up checks ("Sprawdzamy z bliska").
  await p.waitForFunction(() => {
    const text = document.body.innerText;
    return !/Wczytujemy zdjęcie lotnicze|Czytamy okolicę|Sprawdzamy z bliska|Sprawdzamy na zbliżeniach/.test(text) && /Jak dojść i wejść/.test(text);
  }, null, { timeout: 120_000, polling: 250 });
  await p.waitForTimeout(800);
}
/** Synthetic test photo (grey steps) — never a picture of a real place. */
async function testPhoto() {
  const steps = Array.from({ length: 9 }, (_, i) => {
    const y = 560 - i * 52, inset = i * 34;
    return `<polygon points="${40 + inset},${y} ${760 - inset},${y} ${745 - inset},${y - 22} ${55 + inset},${y - 22}" fill="#b9b4ab"/><rect x="${55 + inset}" y="${y - 52}" width="${690 - 2 * inset}" height="30" fill="#8f8a82"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ea"/><stop offset="1" stop-color="#c9ced0"/></linearGradient></defs><rect width="800" height="600" fill="url(#sky)"/><rect y="560" width="800" height="40" fill="#a9a49b"/>${steps}<line x1="70" y1="520" x2="340" y2="90" stroke="#3d3d3d" stroke-width="7"/><line x1="70" y1="520" x2="70" y2="575" stroke="#3d3d3d" stroke-width="7"/><line x1="340" y1="90" x2="340" y2="140" stroke="#3d3d3d" stroke-width="7"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

// ---------- screenshot scenes ----------
const shot = async (p, device, name) => {
  await p.screenshot({ path: path.join(ASSETS, `${device}-${name}.png`) });
  console.log('  ✓', `${device}-${name}.png`);
};

const scenes = {
  /** Needs: described in own words, turned into editable settings. */
  async needs(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await openPreferences(p);
    const box = p.getByPlaceholder(/schodzenie po schodach mnie dziś boli/);
    await box.fill(NEEDS_TEXT);
    await p.getByRole('button', { name: 'Ustaw na podstawie opisu' }).click();
    // The AI's short note (or the generic "updated" line) appears as a status once the settings are applied.
    await p.locator('p[role="status"].bg-accent').waitFor({ timeout: 45_000 });
    await p.getByRole('button', { name: 'Ustaw na podstawie opisu' }).scrollIntoViewIfNeeded();
    await p.waitForTimeout(600);
    await shot(p, d, 'needs-ai');
    // The person corrects the stairs setting by hand: down is the problem today, up is fine.
    await p.getByRole('radio', { name: /Unikam w dół/ }).or(p.getByRole('button', { name: /Unikam w dół/ })).first().click();
    await p.getByRole('heading', { name: 'Jak idziesz dzisiaj?' }).scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await shot(p, d, 'needs-settings');
  },
  /** Transit results Dworzec Główny → Wawel with today's needs. */
  async routes(p, d) {
    await p.goto(trip(DWORZEC, WAWEL), { waitUntil: 'networkidle' });
    await waitRoutes(p);
    await sheet(p, 'half');
    if (isPhone(p)) await scrollPanelTo(p, routesHeading(p), 4);
    await shot(p, d, 'routes');
  },
  /** Route detail: step timeline, stairs up (allowed today), benches for rest stops. */
  async detail(p, d) {
    await p.goto(trip(DWORZEC, WAWEL), { waitUntil: 'networkidle' });
    await waitRoutes(p);
    await p.getByRole('button', { name: /Szczegóły trasy/ }).first().click();
    await p.getByRole('heading', { name: 'Krok po kroku' }).waitFor();
    await settleMap(p, 1200);
    await sheet(p, 'full');
    await shot(p, d, 'detail');
    await scrollPanelTo(p, p.getByRole('heading', { name: 'Krok po kroku' }));
    await shot(p, d, 'detail-steps');
    // A stairs fact: direction relative to this walk, steps, handrail, source and dates.
    const stairs = p.getByRole('button', { name: /Schody w (górę|dół)/ }).first();
    if (await stairs.count()) {
      await stairs.scrollIntoViewIfNeeded();
      await stairs.click();
      await p.getByText(/Pobrano|pobrano/).first().waitFor({ timeout: 10_000 }).catch(() => {});
      await p.waitForTimeout(700);
      await shot(p, d, 'stairs-fact');
    }
  },
  /** Same stairs, other direction: the way back avoids them because going down is excluded today. */
  async stairs(p, d) {
    await p.goto(trip(WAWEL, DWORZEC, '&mode=walk'), { waitUntil: 'networkidle' });
    await waitRoutes(p);
    await sheet(p, 'full');
    await scrollPanelTo(p, routesHeading(p), 4);
    await shot(p, d, 'walk-back');
    const shortest = p.locator('li', { hasText: 'Najkrótsza' }).last();
    await shortest.getByRole('button', { name: /Wybierz/ }).click().catch(() => {});
    await settleMap(p, 1200);
    await sheet(p, 'half');
    await shot(p, d, 'walk-back-stairs');
  },
  /** A place with several sources: OSM building + entrances + City of Kraków list, provenance expanded. */
  async place(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await openExplorePlace(p, 'Krakowskie Centrum Świadczeń', 'Krakowskie Centrum Świadczeń');
    await settleMap(p, 800);
    await shot(p, d, 'place');
    const sources = p.getByRole('button', { name: /^Źródła:/ }).first();
    await sources.scrollIntoViewIfNeeded();
    await sources.click();
    await p.getByText(/^Pobrano /).first().waitFor();
    await scrollPanelTo(p, sources, 16);
    await shot(p, d, 'place-sources');
  },
  /** Incomplete data: a well-known venue whose key facts are mostly unknown stays "Brak danych". */
  async missing(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await openExplorePlace(p, 'Filharmonia', 'Filharmonia Krakowska');
    await settleMap(p, 800);
    await shot(p, d, 'place-missing');
  },
  /** Bird's-eye view: GUGiK orthophoto + OSM pins, AI way-in advice, then observations re-checked on close-ups. */
  async aerial(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await openExplorePlace(p, 'Muzeum Narodowe', 'Muzeum Narodowe w Krakowie');
    await waitAerial(p);
    const title = p.getByRole('heading', { name: 'Okolica z lotu ptaka' });
    await scrollPanelTo(p, title, 8);
    await shot(p, d, 'aerial');
    await scrollPanelTo(p, p.getByRole('heading', { name: 'Jak dojść i wejść' }), 8);
    const obs = p.getByRole('button', { name: /^Na zdjęciu widać/ });
    if (await obs.count()) await obs.click();
    await p.waitForTimeout(400);
    await shot(p, d, 'aerial-advice');
  },
  /** Explore: places in the visible map area, with what is known about each. */
  async explore(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Odkrywaj' }).click();
    await p.getByText(/W widocznym obszarze mapy|W całym Krakowie/).first().waitFor({ timeout: 20_000 });
    await settleMap(p, 1500);
    await shot(p, d, 'explore');
  },
  /** One-photo report: AI description, unverified status, author can fix or delete. Deleted again afterwards. */
  async report(p, d) {
    await p.goto(trip(DWORZEC, WAWEL), { waitUntil: 'networkidle' });
    await waitRoutes(p);
    await p.getByRole('button', { name: /^Zgłoś( problem)?$/ }).first().click();
    await p.getByText('Nie udało mi się dotrzeć').waitFor();
    await p.waitForTimeout(400);
    await shot(p, d, 'report-chooser');
    await choosePhoto(p, l => l.click());
    await p.getByText(/^Dodano:|Zdjęcie zapisane/).first().waitFor({ timeout: 60_000 });
    await p.getByRole('button', { name: 'Popraw' }).click();
    await p.getByRole('button', { name: 'Usuń zgłoszenie' }).waitFor();
    await p.waitForTimeout(600);
    await shot(p, d, 'report-edit');
    await p.getByRole('button', { name: 'Usuń zgłoszenie' }).click();
    await p.getByRole('button', { name: 'Kliknij ponownie, aby usunąć' }).click();
    await p.getByText('Zgłoszenie usunięte.').waitFor();
  },
  /** Wheelchair walk at Rondo Mogilskie: the "Inny przebieg" option passes a lift ("Winda · dostępna dla wózków"). */
  async lift(p, d) {
    await p.goto(`${BASE}/?from=50.06647%2C19.96&to=50.06407%2C19.96&date=${DATE}&time=${TIME}&mode=walk`, { waitUntil: 'networkidle' });
    await waitRoutes(p);
    const alt = p.locator('li', { hasText: 'Inny przebieg' }).first();
    await alt.getByRole('button', { name: /Szczegóły trasy/ }).first().click()
      .catch(() => alt.getByRole('button').first().click());
    await p.getByRole('heading', { name: 'Krok po kroku' }).waitFor();
    await settleMap(p, 1200);
    await sheet(p, 'full');
    const lift = p.getByText(/Winda · dostępna dla wózków/).first();
    await scrollPanelTo(p, lift, 120);
    await shot(p, d, 'lift');
  },
  /** Explore → purple "Zgłoszenia" category: public reports with their status. */
  async reports(p, d) {
    await p.goto(`${BASE}/?category=reports`, { waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Odkrywaj' }).click().catch(() => {});
    await p.waitForTimeout(1500);
    const citywide = p.getByRole('button', { name: 'Szukaj w całym Krakowie' });
    if (await citywide.isVisible().catch(() => false)) await citywide.click();
    await sheet(p, 'half');
    await settleMap(p, 1500);
    await shot(p, d, 'reports');
  },
  /** Partner widget on a (clearly fictional) hotel page. */
  async embed(p, d) {
    await p.goto(`${BASE}/embed?to=50.05411,19.93541&name=Wawel`, { waitUntil: 'networkidle' });
    await p.getByRole('combobox', { name: /Skąd/ }).first().waitFor();
    await settleMap(p, 800);
    await shot(p, d, 'embed');
    if (d === 'desktop') {
      await p.setContent(partnerPage(`${BASE}/embed?to=50.05411,19.93541&name=Wawel`), { waitUntil: 'networkidle' });
      await p.frameLocator('iframe').getByRole('combobox', { name: /Skąd/ }).first().waitFor({ timeout: 30_000 });
      await p.waitForTimeout(2500);
      await shot(p, d, 'embed-partner');
    }
  },
  /** "O danych": sources, privacy and deleting this browser's data. */
  async about(p, d) {
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.getByRole('button', { name: /O danych|Informacje o danych/ }).first().click();
    await p.getByRole('heading', { name: 'Skąd są dane' }).waitFor();
    await p.waitForTimeout(500);
    await shot(p, d, 'about');
    const privacy = p.getByRole('heading', { name: 'Prywatność' }).first();
    if (await privacy.count()) {
      await privacy.scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      await shot(p, d, 'about-privacy');
    }
  },
  /** City dashboard on a scratch instance (needs CITY_URL + CITY_PASSWORD). */
  async city(p, d) {
    if (!CITY_URL || !CITY_PASSWORD) return console.log('  – city: skipped (set CITY_URL and CITY_PASSWORD)');
    await cityLogin(p);
    await seedCity(p);
    await p.goto(`${CITY_URL}/city`, { waitUntil: 'networkidle' });
    await p.getByText(/Zgłoszenia|zgłoszeń/).first().waitFor();
    await p.waitForTimeout(800);
    await shot(p, d, 'city');
  },
};

function partnerPage(src) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
  body{margin:0;font:16px/1.5 Georgia,serif;background:#f7f3ec;color:#2b2420}
  header{padding:22px 48px;background:#2b2420;color:#f7f3ec;display:flex;justify-content:space-between;align-items:center}
  header b{font-size:24px;letter-spacing:.04em} nav span{margin-left:28px;opacity:.85}
  main{display:grid;grid-template-columns:1fr 560px;gap:40px;padding:36px 48px}
  h1{font-size:40px;margin:0 0 12px} .tag{display:inline-block;background:#e8dccb;padding:4px 10px;border-radius:6px;font:13px system-ui;margin-bottom:16px}
  iframe{width:560px;height:720px;border:1px solid #d6cbbb;border-radius:14px;background:#fff}
  </style></head><body><header><b>HOTEL PRZYKŁADOWY</b><nav><span>Pokoje</span><span>Restauracja</span><span>Dojazd</span><span>Rezerwacja</span></nav></header>
  <main><section><span class="tag">Przykładowa strona partnera — nie jest to prawdziwy hotel</span><h1>Dojazd i dostępność</h1>
  <p>Wejście główne bez stopni od ul. Przykładowej. Winda do wszystkich pięter, pokój przystosowany na parterze.</p>
  <p>Poniżej planer <b>Każdy Krok</b>: wpisz, skąd jedziesz, i zobacz trasę do nas z uwzględnieniem schodów, krawężników i miejsc odpoczynku.</p></section>
  <iframe title="Jak do nas dotrzeć bez barier" src="${src}" allow="geolocation"></iframe></main></body></html>`;
}

async function cityLogin(p) {
  await p.goto(`${CITY_URL}/city`, { waitUntil: 'networkidle' });
  const pw = p.locator('input[type="password"]');
  if (await pw.count()) {
    await pw.fill(CITY_PASSWORD);
    await pw.press('Enter');
    await p.waitForLoadState('networkidle');
    await p.locator('input[type="password"]').waitFor({ state: 'detached', timeout: 15_000 });
  }
}

/** Sample reports for the scratch city dashboard, marked as test data in their text. */
async function seedCity(p) {
  const req = p.request;
  const have = await (await req.get(`${CITY_URL}/api/city/reports`)).json().catch(() => ({ reports: [] }));
  if ((have.reports ?? []).length >= 3) return;
  const headers = { Origin: CITY_URL, 'Content-Type': 'application/json' };
  const samples = [
    { type: 'blocked', location: { lat: 50.06686, lon: 19.94629 }, comment: '[dane testowe] Winda z peronu do hali dworca nie działała, schody były jedyną drogą.', destination: 'Dworzec Główny, hala' },
    { type: 'barrier', location: { lat: 50.06190, lon: 19.93730 }, comment: '[dane testowe] Wysoki krawężnik bez obniżenia na przejściu przez Grodzką.' },
    { type: 'barrier', location: { lat: 50.05470, lon: 19.93560 }, comment: '[dane testowe] Brak poręczy na krótkich schodach przy bramie, mokre stopnie.' },
    { type: 'blocked', location: { lat: 50.04990, lon: 19.94430 }, comment: '[dane testowe] Chodnik zastawiony rusztowaniem, przejście tylko jezdnią.', destination: 'Kazimierz' },
  ];
  const created = [];
  for (const s of samples) {
    const body = { location: { ...s.location, id: `point:${s.location.lat}:${s.location.lon}`, name: 'Punkt na mapie', source: 'map' }, locationSource: 'map', locale: 'pl', type: s.type, comment: s.comment, ...(s.destination ? { destination: s.destination } : {}) };
    const res = await req.post(`${CITY_URL}/api/reports/auto`, { headers, data: body });
    if (res.ok()) created.push((await res.json()).report.id);
    else console.log('  seed failed', res.status(), await res.text());
  }
  const statuses = [['in_review', 'Przekazano do ZDMK do sprawdzenia windy.'], ['forwarded', 'Zgłoszono zarządcy drogi.']];
  for (const [i, [status, note]] of statuses.entries()) {
    if (created[i]) await req.patch(`${CITY_URL}/api/city/reports/${created[i]}`, { headers, data: { status, note } });
  }
}

async function runShots() {
  mkdirSync(ASSETS, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  for (const device of ['desktop', 'phone']) {
    for (const [name, scene] of Object.entries(scenes)) {
      if (ONLY && !ONLY.has(name)) continue;
      console.log(device, name);
      // The needs scene starts from the default settings so the AI visibly changes them.
      const ctx = await context(browser, device, { prefs: name === 'needs' ? null : name === 'lift' ? WHEELCHAIR : PERSONA });
      const p = await ctx.newPage();
      try {
        await scene(p, device);
      } catch (e) {
        failures.push(`${device}/${name}: ${e.message.split('\n')[0]}`);
        await p.screenshot({ path: path.join(ASSETS, `_failed-${device}-${name}.png`) }).catch(() => {});
      }
      await ctx.close();
    }
  }
  await browser.close();
  if (failures.length) {
    console.log('\nFailed scenes:\n' + failures.join('\n'));
    process.exitCode = 1;
  }
}


// ---------- demo recording ----------
// Each recorded page becomes one raw .webm. `clip()` marks where a captioned piece starts (seconds since the page
// opened); `cut()` ends it so waits (AI, routing) are left out. competition-video.py turns the timeline into the MP4.
const RIPPLE = `(() => {
  const css = document.createElement('style');
  css.textContent = '@keyframes kk-tap{from{transform:scale(.35);opacity:.95}to{transform:scale(1.5);opacity:0}}.kk-tap{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;border:5px solid #c4122f;background:rgba(196,18,47,.22);pointer-events:none;z-index:2147483647;animation:kk-tap .8s ease-out forwards}';
  const add = () => document.head.append(css);
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  addEventListener('pointerdown', e => {
    const d = document.createElement('div');
    d.className = 'kk-tap';
    d.style.left = e.clientX + 'px';
    d.style.top = e.clientY + 'px';
    document.documentElement.append(d);
    setTimeout(() => d.remove(), 900);
  }, true);
})()`;

function recorder(p, device) {
  const t0 = Date.now();
  const clips = [];
  let open = null;
  const now = () => (Date.now() - t0) / 1000;
  return {
    device, clips,
    clip(caption, step, extra = {}) {
      if (open) open.end = now();
      open = { start: now(), end: null, caption, step, ...extra };
      clips.push(open);
    },
    cut() {
      if (open) open.end = now();
      open = null;
    },
  };
}
const LOAD_COUNTER = `try { sessionStorage.setItem('kk-loads', String(Number(sessionStorage.getItem('kk-loads') || 0) + 1)); } catch {}`;
class Reloaded extends Error {}
async function assertNoReload(p) {
  const loads = await p.evaluate(() => Number(sessionStorage.getItem('kk-loads') || 0)).catch(() => 0);
  if (loads > 1) throw new Reloaded('page reloaded');
}
const pause = async (p, ms) => {
  await p.waitForTimeout(ms);
  await assertNoReload(p);
};
/** A deliberate tap: bring into view, rest on it, tap, let the result show. */
async function tap(p, locator, after = 900) {
  await assertNoReload(p);
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await el.hover().catch(() => {});
  await pause(p, 450);
  await el.click();
  await pause(p, after);
}
async function smoothScroll(p, locator, offset = 12) {
  await locator.first().evaluate((el, off) => {
    let s = el.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (!s) return el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    s.scrollTo({ top: s.scrollTop + el.getBoundingClientRect().top - s.getBoundingClientRect().top - off, behavior: 'smooth' });
  }, offset);
  await pause(p, 1100);
}

async function recordPhone(browser) {
  // A dev server reloads the page when its source changes (hot reload); such a take is discarded and recorded again.
  for (let attempt = 1; ; attempt++) {
    const dir = path.join(RAW, 'phone');
    rmSync(dir, { recursive: true, force: true });
    const ctx = await context(browser, 'phone', { prefs: null, video: { dir, size: { width: 390, height: 844 } } });
    await ctx.addInitScript(RIPPLE);
    await ctx.addInitScript(LOAD_COUNTER);
    const p = await ctx.newPage();
    const r = recorder(p, 'phone');
    try {
      await phoneStory(p, r);
    } catch (e) {
      await p.screenshot({ path: path.join(RAW, '_failed-phone.png') }).catch(() => {});
      const reloaded = e instanceof Reloaded || (await assertNoReload(p).then(() => false, err => err instanceof Reloaded));
      await ctx.close();
      if (reloaded && attempt < 6) {
        console.log(`  page reloaded by the server during take ${attempt}; recording again`);
        continue;
      }
      throw e;
    }
    const video = p.video();
    await ctx.close();
    return { file: await video.path(), device: 'phone', viewport: { width: 390, height: 844 }, clips: r.clips };
  }
}

async function phoneStory(p, r) {

  // 1. Needs, in own words → editable settings.
  await p.goto(trip(DWORZEC, WAWEL), { waitUntil: 'networkidle' });
  await waitRoutes(p);
  await sheet(p, 'half');
  await pause(p, 600);
  r.clip('Anna chodzi dziś o kulach. Jedzie z Dworca Głównego na Wawel. Zaczyna od potrzeb, nie od diagnozy.', 'Potrzeby');
  await pause(p, 2500);
  await tap(p, p.getByRole('button', { name: /Twoje potrzeby na dziś/ }));
  await p.getByRole('heading', { name: 'Jak idziesz dzisiaj?' }).waitFor();
  const box = p.getByPlaceholder(/schodzenie po schodach mnie dziś boli/);
  await smoothScroll(p, p.getByText('Albo opisz to własnymi słowami'), 80);
  r.clip('Opisuje to własnymi słowami. AI zamienia opis na ustawienia, które widać i można zmienić.', 'Potrzeby');
  await box.click();
  await box.pressSequentially(NEEDS_TEXT, { delay: 22 });
  await pause(p, 600);
  await tap(p, p.getByRole('button', { name: 'Ustaw na podstawie opisu' }), 200);
  r.cut();
  await p.locator('p[role="status"].bg-accent').waitFor({ timeout: 45_000 });
  await pause(p, 300);
  r.clip('Opisuje to własnymi słowami. AI zamienia opis na ustawienia, które widać i można zmienić.', 'Potrzeby');
  await pause(p, 2200);
  await smoothScroll(p, p.getByRole('heading', { name: 'Jak idziesz dzisiaj?' }), 10);
  r.clip('Schody w dół bolą, w górę da radę: kierunek schodów to osobne ustawienie. Anna poprawia je jednym dotknięciem.', 'Potrzeby');
  await pause(p, 1500);
  await tap(p, p.getByRole('radio', { name: /Unikam w dół/ }).or(p.getByRole('button', { name: /Unikam w dół/ })), 1500);
  await tap(p, p.getByRole('button', { name: 'Pokaż trasy' }), 300);
  r.cut();
  await waitRoutes(p);
  await sheet(p, 'half');
  await smoothScroll(p, routesHeading(p), 4);

  // 2. Routes with barriers placed where they occur.
  r.clip('Warianty tramwajem i pieszo. Pasek pokazuje, gdzie są schody (tu: w górę), ławki i przerwy co 10 minut.', 'Trasa');
  await pause(p, 5500);
  await tap(p, p.getByRole('button', { name: /Szczegóły trasy/ }), 300);
  await p.getByRole('heading', { name: 'Krok po kroku' }).waitFor();
  await sheet(p, 'full');
  await pause(p, 600);
  r.clip('Krok po kroku: przystanek, tramwaj 76, dojście. Toalety przystosowane i ławka na odpoczynek po 10 minutach.', 'Bariery i udogodnienia');
  await pause(p, 2500);
  await smoothScroll(p, p.getByRole('button', { name: /Schody w górę/ }), 180);
  await pause(p, 2500);
  r.clip('Każdy fakt ma źródło i daty: OpenStreetMap, pobrano, ostatnia edycja, brak potwierdzenia na miejscu.', 'Źródło i data');
  await tap(p, p.getByRole('button', { name: /Schody w górę/ }), 4500);
  await p.keyboard.press('Escape');
  await pause(p, 600);
  // Escape may already have returned to the list (it closes the fact sheet and the detail view).
  const back = p.getByRole('button', { name: 'Wszystkie trasy' });
  if (await back.isVisible()) await tap(p, back, 300);
  await sheet(p, 'half');

  // 3. Same stairs, other direction.
  r.clip('Droga powrotna: te same schody są teraz w dół. Wariant z nimi jest oznaczony jako niepasujący do dzisiaj.', 'Kierunek schodów');
  await smoothScroll(p, p.getByRole('button', { name: 'Zamień start i cel' }), 60);
  await tap(p, p.getByRole('button', { name: 'Zamień start i cel' }), 200);
  r.cut();
  await waitRoutes(p);
  r.clip('Droga powrotna: te same schody są teraz w dół. Wariant z nimi jest oznaczony jako niepasujący do dzisiaj.', 'Kierunek schodów');
  await smoothScroll(p, p.locator('li', { hasText: 'Najkrótsza' }).last(), 40);
  await pause(p, 5000);

  // 4. A place: facts, conflicting entrances, missing data, provenance.
  r.clip('Odkrywaj: ok. 3 080 miejsc z OSM, wykaz budynków Urzędu Miasta i deklaracje właścicieli.', 'Miejsca');
  await smoothScroll(p, p.getByRole('tab', { name: 'Odkrywaj' }), 0);
  await tap(p, p.getByRole('tab', { name: 'Odkrywaj' }), 1500);
  const search = p.getByPlaceholder('Muzeum, zabytek, toaleta…');
  await tap(p, search, 200);
  await search.pressSequentially('Krakowskie Centrum Świadczeń', { delay: 40 });
  const hit = await findInList(p, 'Krakowskie Centrum Świadczeń');
  await pause(p, 900);
  await tap(p, hit, 200);
  await p.getByRole('heading', { name: /^Krakowskie Centrum Świadczeń/ }).first().waitFor();
  await pause(p, 800);
  r.clip('Najpierw cztery kluczowe fakty. Wejścia się różnią, więc piszemy „nie przy każdym wejściu”. Parking: brak danych.', 'Niepełne dane');
  await pause(p, 5500);
  await smoothScroll(p, p.getByRole('heading', { name: 'Bariery i udogodnienia' }), 10);
  await pause(p, 3000);
  const sources = p.getByRole('button', { name: /^Źródła:/ }).first();
  r.clip('Pochodzenie: Urząd Miasta i OpenStreetMap, z datą pobrania, datą edycji i informacją, że nikt nie potwierdził tego na miejscu.', 'Źródło i data');
  await smoothScroll(p, sources, 60);
  await tap(p, sources, 300);
  await smoothScroll(p, sources, 20);
  await pause(p, 5000);
  r.cut();

  // 5. Missing data is shown as missing.
  await p.keyboard.press('Escape');
  await pause(p, 500);
  await search.fill('');
  await search.pressSequentially('Filharmonia', { delay: 45 });
  const fil = await findInList(p, 'Filharmonia Krakowska');
  await fil.click();
  await p.getByRole('heading', { name: /^Filharmonia Krakowska/ }).first().waitFor();
  await pause(p, 600);
  r.clip('Brak informacji zostaje brakiem: Filharmonia nie ma w źródłach danych o wejściu, toalecie ani windzie. Nie zgadujemy.', 'Brak danych');
  await pause(p, 5000);
  r.cut();

  // 6. Bird's-eye view: orthophoto + map pins + AI way-in advice.
  await p.keyboard.press('Escape');
  await pause(p, 500);
  await search.fill('');
  await search.pressSequentially('Muzeum Narodowe', { delay: 45 });
  const mn = await findInList(p, 'Muzeum Narodowe w Krakowie');
  await mn.click();
  await p.getByRole('heading', { name: /^Muzeum Narodowe w Krakowie/ }).first().waitFor();
  await waitAerial(p);
  await smoothScroll(p, p.getByRole('heading', { name: 'Okolica z lotu ptaka' }), 8);
  r.clip('Okolica z lotu ptaka: ortofotomapa GUGiK z punktami z OSM: wejścia, przystanki, schody, parkingi.', 'Z lotu ptaka');
  await pause(p, 4500);
  await smoothScroll(p, p.getByRole('heading', { name: 'Jak dojść i wejść' }), 8);
  r.clip('AI podpowiada, jak dojść i wejść, na podstawie danych. Gdy wejście nie ma danych w OSM, mówi to wprost.', 'Z lotu ptaka');
  await pause(p, 6000);
  const obs = p.getByRole('button', { name: /^Na zdjęciu widać/ });
  if (await obs.count()) {
    await smoothScroll(p, obs, 200);
    r.clip('Obserwacje ze zdjęcia są sprawdzane na zbliżeniach. Mediana błędu położenia 1,7–2,3 m (12 miejsc).', 'Z lotu ptaka');
    await tap(p, obs, 4500);
  }
  r.cut();

  // 7. One-photo report: AI description, unverified, author can fix or delete (deleted again here).
  await p.keyboard.press('Escape');
  await pause(p, 600);
  r.clip('Coś się zmieniło? Jedno zdjęcie wystarczy. Tu zdjęcie testowe.', 'Zgłoszenie');
  await tap(p, p.getByRole('button', { name: /^Zgłoś( problem)?$/ }), 500);
  await p.getByText('Nie udało mi się dotrzeć').waitFor();
  await pause(p, 1500);
  r.clip('Przed pierwszym zdjęciem krótko: co trafia do AI, co będzie publiczne, jak poprawić lub usunąć.', 'Zgłoszenie');
  await choosePhoto(p, l => tap(p, l, 300), 4500);
  r.cut();
  await p.getByText(/^Dodano:|Zdjęcie zapisane/).first().waitFor({ timeout: 60_000 });
  r.clip('AI opisuje zdjęcie, usuwa metadane i zapisuje zgłoszenie jako niezweryfikowane. Autor może je poprawić lub usunąć.', 'Zgłoszenie');
  await pause(p, 1800);
  await tap(p, p.getByRole('button', { name: 'Popraw' }), 4500);
  await tap(p, p.getByRole('button', { name: 'Usuń zgłoszenie' }), 400);
  await tap(p, p.getByRole('button', { name: 'Kliknij ponownie, aby usunąć' }), 200);
  await p.getByText('Zgłoszenie usunięte.').waitFor();
  await pause(p, 1500);
  r.cut();
}

async function recordDesktop(browser) {
  const dir = path.join(RAW, 'desktop');
  rmSync(dir, { recursive: true, force: true });
  const ctx = await context(browser, 'desktop', { video: { dir, size: { width: 1440, height: 900 } } });
  await ctx.addInitScript(RIPPLE);
  const p = await ctx.newPage();
  const r = recorder(p, 'desktop');
  const results = [];

  // 8. Partner widget on a (fictional) hotel page.
  // Warm the widget route, then show it inside a mock partner page served from the same origin.
  await p.goto(`${BASE}/embed?to=50.05411,19.93541&name=Wawel`, { waitUntil: 'networkidle' });
  await p.setContent(partnerPage(`${BASE}/embed?to=50.05411,19.93541&name=Wawel`), { waitUntil: 'networkidle' });
  const frame = p.frameLocator('iframe');
  await frame.getByRole('combobox', { name: /Skąd/ }).first().waitFor({ timeout: 90_000 });
  await pause(p, 1500);
  r.clip('Hotel, muzeum albo organizator wydarzenia osadza widżet „Jak do nas dotrzeć bez barier” jedną linijką kodu.', 'Partnerzy');
  await pause(p, 3000);
  const from = frame.getByRole('combobox', { name: /Skąd/ }).first();
  await from.click();
  await from.pressSequentially('Rynek Główny', { delay: 60 });
  const opt = frame.getByRole('option').first();
  await opt.waitFor({ timeout: 20_000 });
  await pause(p, 600);
  await opt.click();
  r.cut();
  await frame.getByRole('heading', { name: /^Trasy \(\d+\)/ }).waitFor({ timeout: 90_000 });
  await pause(p, 1200);
  r.clip('Gość widzi trasę dopasowaną do swoich potrzeb, a obiekt nie musi utrzymywać własnej mapy.', 'Partnerzy');
  await pause(p, 4500);
  r.cut();

  // 9. City dashboard (scratch instance with sample reports).
  if (CITY_URL && CITY_PASSWORD) {
    await cityLogin(p);
    await seedCity(p);
    await p.goto(`${CITY_URL}/city`, { waitUntil: 'networkidle' });
    await p.getByText('Zgłoszenia mieszkańców').waitFor();
    await pause(p, 800);
    r.clip('Panel miasta: zgłoszenia z filtrami, statusem, odpowiedzią i eksportem CSV. Tu przykładowe dane testowe.', 'Miasto');
    await pause(p, 3000);
    await tap(p, p.getByText('Uniemożliwiło dotarcie').first(), 3000);
    r.cut();
  } else console.log('  – city dashboard not recorded (set CITY_URL and CITY_PASSWORD)');

  const video = p.video();
  await ctx.close();
  results.push({ file: await video.path(), device: 'desktop', viewport: { width: 1440, height: 900 }, clips: r.clips });
  return results;
}

async function recordDemo() {
  mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch();
  const failed = name => e => {
    console.error(`${name} recording failed: ${e.message.split('\n')[0]}`);
    throw e;
  };
  // VIDEO_PART=phone|desktop re-records one part and keeps the other from the previous run.
  const parts = process.env.VIDEO_PART ? [process.env.VIDEO_PART] : ['phone', 'desktop'];
  if (parts.includes('phone')) writeFileSync(path.join(RAW, 'phone.json'), JSON.stringify([await recordPhone(browser).catch(failed('phone'))], null, 2));
  if (parts.includes('desktop')) writeFileSync(path.join(RAW, 'desktop.json'), JSON.stringify(await recordDesktop(browser).catch(failed('desktop')), null, 2));
  await browser.close();
  const read = f => { try { return JSON.parse(readFileSync(path.join(RAW, f), 'utf8')); } catch { console.log(`  – ${f} missing, part not included`); return []; } };
  const timeline = { recordedAt: new Date().toISOString(), base: BASE, videos: [...read('phone.json'), ...read('desktop.json')] };
  writeFileSync(path.join(RAW, 'timeline.json'), JSON.stringify(timeline, null, 2));
  console.log('timeline →', path.join(RAW, 'timeline.json'));
}

if (mode === 'shots' || mode === 'all') await runShots();
if (mode === 'video' || mode === 'all') {
  await recordDemo();
}
