/** Katta xarita, metka va teleport testi. */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '../../../3d virtual home/node_modules/playwright-core/index.mjs';
const out = process.argv[2] ?? './shots'; mkdirSync(out, { recursive: true });
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.querySelector('.boot'), { timeout: 90_000 }).catch(()=>{});
await page.waitForTimeout(4000);

const pos = () => page.evaluate(() => {
  const p = window.__xarita.city.playerState;
  return p ? { x: +p.position.x.toFixed(1), z: +p.position.z.toFixed(1) } : null;
});
console.log('boshlang\'ich joy:', JSON.stringify(await pos()));
await page.screenshot({ path: join(out, '1-oyin.png') });

// Mini-xaritani bosib katta xaritani ochamiz.
await page.locator('.minimap canvas').click();
console.log('xarita ochildi, tayyorlanmoqda...');
await page.waitForFunction(() => {
  const s = document.querySelector('.bigmap-status');
  return document.querySelector('.bigmap canvas') && !s;
}, { timeout: 120_000 }).catch(() => console.log('  (xarita tayyor bo\'lmadi)'));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, '2-xarita.png') });

// Xaritaning chetroq joyiga bosib metka qo'yamiz.
const box = await page.locator('.bigmap-canvas canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.35);
await page.waitForTimeout(900);
const badge = await page.locator('.bigmap-panel footer').textContent();
console.log('metka:', badge?.trim().slice(0, 60));
await page.screenshot({ path: join(out, '3-metka.png') });

// Teleport.
const before = await pos();
await page.locator('.bigmap-panel footer button.primary').click();
await page.waitForTimeout(4000);
const after = await pos();
const moved = Math.hypot(after.x - before.x, after.z - before.z);
console.log(`teleport: ${JSON.stringify(before)} -> ${JSON.stringify(after)}  (${(moved/1000).toFixed(2)} km)`);
await page.waitForTimeout(3000);
await page.screenshot({ path: join(out, '4-yangi-joy.png') });

console.log('xatolar:', errors.length ? errors.slice(0,4) : 'yo\'q');
await browser.close();
