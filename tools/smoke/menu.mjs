import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 120000 });

  await page.evaluate(() => window.__xarita.engine.stop());
  await page.evaluate(() => window.__xarita.engine.renderer.render(window.__xarita.engine.scene, window.__xarita.engine.camera));

  mkdirSync('artifacts', { recursive: true });

  // 1. Yangi ixcham ko'rinish (ochiq holatda)
  await page.screenshot({ path: 'artifacts/menu-compact.png', timeout: 60000 });

  // 2. Tugmani bosib yig'ish (collapsed holat)
  await page.getByRole('button', { name: "Menyuni yig'ish" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/menu-collapsed.png', timeout: 60000 });

  console.log('PASS: menu-compact and menu-collapsed captured successfully');
} finally {
  await browser.close();
}
