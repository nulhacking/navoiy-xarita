/** Gravitatsiya va yerga yopishish tekshiruvi. */
import { existsSync } from 'node:fs';
import { chromium } from '../../../3d virtual home/node_modules/playwright-core/index.mjs';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.querySelector('.boot'), { timeout: 90_000 }).catch(()=>{});
await page.waitForTimeout(4000);

/** Kapsula pastki nuqtasi bilan relyef orasidagi farq. Ideal: ~0. */
async function gap() {
  return page.evaluate(() => {
    const c = window.__xarita.city;
    const p = c.playerState;
    if (!p || !c.ground) return null;
    const feetY = p.position.y - (0.55 + 0.35);   // kapsula yarim balandligi + radius
    const groundY = c.ground.heightAt(p.position.x, p.position.z);
    return { gap: +(feetY - groundY).toFixed(3), y: +p.position.y.toFixed(2), groundY: +groundY.toFixed(2), grounded: p.grounded };
  });
}

console.log('tug\'ilgandan keyin:', JSON.stringify(await gap()));

await page.mouse.click(480, 300);
await page.waitForTimeout(400);

// Turli yo'nalishlarda yurib, farq barqaror qoladimi.
for (const [key, name] of [['KeyW','shimol'],['KeyD','sharq'],['KeyS','janub'],['KeyA','g\'arb']]) {
  await page.keyboard.down(key);
  await page.waitForTimeout(2500);
  await page.keyboard.up(key);
  await page.waitForTimeout(700);
  console.log(`${name.padEnd(7)} yurgandan keyin:`, JSON.stringify(await gap()));
}

// Sakrash: ko'tarilib, qaytib tushishi kerak.
const before = await gap();
await page.keyboard.down('Space');
await page.waitForTimeout(250);
await page.keyboard.up('Space');
await page.waitForTimeout(400);
const mid = await gap();
await page.waitForTimeout(2500);
const after = await gap();
console.log(`sakrash: ${before.gap} -> ${mid.gap} (havoda) -> ${after.gap} (qaytdi)`);

console.log('xatolar:', errors.length ? errors.slice(0,3) : 'yo\'q');
await browser.close();
