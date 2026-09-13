/** Navoiy o'yin rejimi testi: yuklanish, yurish, mashina. */
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '../../../3d virtual home/node_modules/playwright-core/index.mjs';

const out = process.argv[2] ?? './shots';
mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

// Yuklanish ekrani yo'qolishini kutamiz.
await page.waitForFunction(() => !document.querySelector('.boot'), { timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(4000);

async function stats() {
  return page.evaluate(() => {
    const rows = Object.fromEntries([...document.querySelectorAll('.stats .row')].map(r => [
      r.querySelector('span')?.textContent?.trim(), r.querySelector('b')?.textContent?.trim()]));
    const w = window.__xarita?.city;
    const p = w?.playerState;
    return { rows, pos: p ? { x: +p.position.x.toFixed(1), y: +p.position.y.toFixed(1), z: +p.position.z.toFixed(1) } : null,
             mode: p?.mode, grounded: p?.grounded, nearCar: p?.nearCar };
  });
}

console.log('yuklandi:', JSON.stringify(await stats()));
await page.screenshot({ path: join(out, '1-spawn.png') });

// Piyoda yurish: W ni ushlab turamiz.
const before = await stats();
await page.mouse.click(640, 400);            // pointer lock
await page.waitForTimeout(400);
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(600);
const after = await stats();
const walked = before.pos && after.pos ? Math.hypot(after.pos.x-before.pos.x, after.pos.z-before.pos.z) : 0;
console.log(`yurdi: ${walked.toFixed(1)} m  ->`, JSON.stringify(after.pos), 'grounded=', after.grounded);
await page.screenshot({ path: join(out, '2-walk.png') });

// Mashinaga o'tirish.
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
const inCar = await stats();
console.log('rejim:', inCar.mode, '| nearCar edi:', after.nearCar);

if (inCar.mode === 'drive') {
  const cb = inCar.pos;
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600);
  const drove = await stats();
  const dist = Math.hypot(drove.pos.x-cb.x, drove.pos.z-cb.z);
  console.log(`haydadi: ${dist.toFixed(1)} m, tezlik ${drove.rows['tezlik'] ?? '-'}`);
  await page.screenshot({ path: join(out, '3-drive.png') });
}

console.log('xatolar:', errors.length ? errors.slice(0,5) : 'yo\'q');
await browser.close();
