// Browser smoke check: Chromium + WebKit, phone + desktop, axe WCAG scan.
// Usage: node scripts/ui-check.mjs [baseUrl]   (screenshots in artifacts/ui/)
import { chromium, webkit, devices } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const stairsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#cfcfcf"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${100 + i * 10}" y="${60 + i * 50}" width="${600 - i * 20}" height="30" fill="#8a8a8a"/>`).join('')}</svg>`;
const photo = await sharp(Buffer.from(stairsSvg)).jpeg().toBuffer();

const base = process.argv[2] ?? 'http://localhost:3030';
mkdirSync('artifacts/ui', { recursive: true });
const runs = [
  { name: 'chromium-iphone', engine: chromium, context: { ...devices['iPhone 13'], defaultBrowserType: undefined } },
  ...(process.env.WEBKIT ? [{ name: 'webkit-iphone', engine: webkit, context: { ...devices['iPhone 13'] } }] : []),
  { name: 'chromium-desktop', engine: chromium, context: { viewport: { width: 1440, height: 900 } } },
];
let failed = false;
for (const run of runs) {
  const browser = await run.engine.launch(run.engine === webkit && process.env.WEBKIT_PATH ? { executablePath: process.env.WEBKIT_PATH } : {});
  const context = await browser.newContext({ ...run.context, locale: 'pl-PL', timezoneId: 'Europe/Warsaw' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  const shot = name => page.screenshot({ path: `artifacts/ui/${run.name}-${name}.png` });
  await shot('1-start');

  await page.getByRole('combobox', { name: 'Skąd' }).fill('florianska 5');
  await page.getByRole('option', { name: /Floriańska 5/ }).first().waitFor();
  await shot('2-autocomplete');
  await page.getByRole('option', { name: /Floriańska 5/ }).first().click();
  await page.getByRole('combobox', { name: 'Dokąd' }).fill('nowa huta plac centralny');
  const option = page.getByRole('option').first();
  await option.waitFor();
  await option.click();
  await page.getByRole('heading', { name: /^Trasy \(\d+\)/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('3-results');

  await page.locator('ul li button').first().click();
  await page.getByRole('heading', { name: 'Krok po kroku' }).waitFor();
  await page.waitForTimeout(2000);
  await shot('4-detail');

  // Preferences panel
  await page.getByRole('button', { name: /Twoje potrzeby na dziś/ }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByRole('button', { name: 'Wszystkie trasy' }).click();
  await page.getByRole('button', { name: /Twoje potrzeby na dziś/ }).click();
  await page.getByRole('heading', { name: 'Jak idziesz dzisiaj?' }).waitFor();
  await page.waitForTimeout(600);
  await shot('5-preferences');
  await page.keyboard.press('Escape');

  // One-tap photo report: AI analyses and saves, then we delete it again.
  if (process.env.REPORT !== '0') {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Zgłoś przeszkodę zdjęciem' }).click();
    await (await chooser).setFiles({ name: 'schody.jpg', mimeType: 'image/jpeg', buffer: photo });
    await page.getByText(/^Dodano:|Zdjęcie zapisane/).waitFor({ timeout: 60000 });
    await shot('6-report-toast');
    await page.getByRole('button', { name: 'Popraw' }).click();
    await page.getByRole('button', { name: 'Usuń zgłoszenie' }).waitFor();
    await page.waitForTimeout(500);
    await shot('7-report-edit');
    await page.getByRole('button', { name: 'Usuń zgłoszenie' }).click();
    await page.getByText('Zgłoszenie usunięte.').waitFor();
  }

  // Wheelchair + car: drive to a parking with disabled spaces, then walk.
  await page.getByRole('button', { name: /Twoje potrzeby na dziś/ }).click();
  await page.getByRole('radio', { name: 'Na wózku' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Samochód' }).click();
  await page.getByRole('heading', { name: /^Trasy \(\d+\)/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('8-car-wheelchair');
  await page.locator('ul li button').first().click();
  await page.getByRole('heading', { name: 'Krok po kroku' }).waitFor();
  await page.getByRole('radio', { name: 'Satelita' }).click();
  await page.waitForTimeout(2500);
  await shot('9-car-detail-satellite');
  await page.getByRole('radio', { name: 'Mapa' }).first().click();
  await page.getByRole('button', { name: 'Wszystkie trasy' }).click();

  // Explore: places with accessibility details, one place, partner form.
  await page.getByRole('tab', { name: 'Odkrywaj' }).click();
  await page.locator('#explore-results ~ ul li button').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot('10-explore');
  await page.locator('#explore-results ~ ul li button').first().click();
  await page.getByRole('heading', { name: 'Bariery i udogodnienia' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await shot('11-place');
  await page.getByRole('button', { name: 'Jesteś właścicielem? Uzupełnij dane' }).click();
  await page.getByRole('button', { name: 'Wyślij dane' }).waitFor();
  await page.waitForTimeout(600);
  await shot('12-partner');
  const partnerAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze();
  await page.keyboard.press('Escape');

  // English interface
  await page.getByRole('button', { name: /Język/ }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await page.getByRole('tab', { name: 'Explore' }).waitFor();
  await shot('13-english');
  await page.evaluate(() => localStorage.removeItem('krok-locale-v1'));

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze();
  axe.violations.push(...partnerAxe.violations);
  const violations = axe.violations.map(v => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`);
  // Embed widget for partner websites
  await page.goto(`${base}/embed?to=50.05302,19.93359&name=Wawel`, { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Skąd' }).waitFor();
  await shot('14-embed');
  const embedAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze();
  violations.push(...embedAxe.violations.map(v => `embed ${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | ')}`));
  console.log(run.name, { axeViolations: violations, pageErrors: errors });
  if (violations.length || errors.length) failed = true;
  await browser.close();
}
process.exit(failed ? 1 : 0);
