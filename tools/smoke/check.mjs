/**
 * Brauzerda "smoke test": sahifa yuklanadimi, konsolda xato bormi, WebGL ishlaydimi.
 * Playwright brauzerlari yuklanmagan bo'lsa, tizimdagi Chrome/Edge dan foydalanadi.
 *
 * Ishlatish:  node tools/smoke/check.mjs [url] [screenshot.png]
 */
import { existsSync } from 'node:fs';
import { chromium } from '../../../3d virtual home/node_modules/playwright-core/index.mjs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const shot = process.argv[3] ?? null;

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Chrome/Edge topilmadi. Yo‘llarni tools/smoke/check.mjs ichida moslang.');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  // SwiftShader — GPU'siz muhitda ham WebGL ishlashi uchun.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
// Relyef tayllari tarmoqdan keladi — birinchi kadrlar uchun vaqt beramiz.
await page.waitForTimeout(Number(process.env.SMOKE_WAIT ?? 9000));

const report = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  let webgl = null;
  if (canvas) {
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    webgl = {
      version: gl ? gl.getParameter(gl.VERSION) : null,
      renderer: gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      size: [canvas.width, canvas.height],
    };
  }
  return {
    title: document.title,
    hasCanvas: Boolean(canvas),
    webgl,
    fatal: document.querySelector('.setup h2')?.textContent ?? null,
    overlay: Boolean(document.querySelector('.overlay')),
    places: [...document.querySelectorAll('.places button')].map((b) => b.textContent?.trim()),
    stats: [...document.querySelectorAll('.stats .row')].map((r) => r.textContent?.trim()),
    attribution: document.querySelector('.attribution .credits')?.textContent ?? null,
  };
});

if (shot) {
  await page.screenshot({ path: shot });
  console.log(`skrinshot → ${shot}`);
}

console.log(JSON.stringify({ ...report, consoleErrors, pageErrors }, null, 2));
await browser.close();

const failed = pageErrors.length > 0;
process.exit(failed ? 1 : 0);
