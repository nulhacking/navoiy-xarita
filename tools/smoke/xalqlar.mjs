import assert from 'node:assert/strict';
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 180000 });
  await page.evaluate(() => window.__xarita.engine.stop());
  await page.getByRole('button', { name: "⌖ Xalqlar Do'stligi shoh ko'chasi", exact: true }).click();
  await page.waitForFunction(() => !window.__xarita.city.teleporting, null, { timeout: 90000 });
  mkdirSync('artifacts', { recursive: true });

  const data = await page.evaluate(() => {
    const { city } = window.__xarita;
    const x = city.xalqlar;
    for (let i = 0; i < 90; i++) city.update({ dt: 1 / 60, elapsed: i / 60, frame: i });
    const hit = (u, v, above) => {
      const p = x.basis.point(u, v), ground = city.ground.heightAt(p.x, p.z);
      return city.physics.groundHeightAt(p.x, ground + above, p.z, above + 10) - ground;
    };
    let invalid = 0, meshes = 0;
    x.group.traverse((n) => {
      if (!n.isMesh || n.isInstancedMesh) return;
      meshes++;
      for (const value of n.geometry.getAttribute('position').array) if (!Number.isFinite(value)) invalid++;
    });
    // Sport Saroyi konturi endi muallif modulida: tayl uni ikkinchi marta chizmasligi kerak.
    let overlappingGeneric = 0;
    for (const tile of city.tiles.values()) for (const b of tile.detailContext.buildings) {
      const q = x.basis.uv({ x: b.ring[0], z: b.ring[1] });
      if (q.u > -113 && q.u < -46 && q.v > -6 && q.v < 60) overlappingGeneric++;
    }
    const coords = x.basis.uv(city.playerState.position);
    city.paused = true;
    return {
      ...x.group.userData, meshes, invalid, overlappingGeneric, coords,
      road: hit(0, -760, 5), median: hit(6.3, -760, 5),
      grounded: city.playerState.grounded,
    };
  });
  console.log(JSON.stringify(data, null, 2));

  // Street View (Lemala 360, 2024-07) nuqtalari va yo'nalishlari bilan bir xil kadrlar.
  const views = [
    { name: 'north-square', u: 3, v: -1053, h: 2.6, tu: 3, tv: -900, th: 2.6, hour: 12.5 },
    { name: 'mall', u: 1, v: -749, h: 2.6, tu: -120, tv: -749, th: 6, hour: 12.5 },
    { name: 'farhod-avenue', u: -1, v: 0, h: 2.6, tu: -1, tv: -120, th: 2.6, hour: 12.5 },
    { name: 'sport-saroyi', u: -1, v: 0, h: 2.6, tu: -120, tv: 0, th: 6, hour: 12.5 },
    { name: 'junction', u: -10, v: 300, h: 14, tu: 40, tv: 420, th: 0, hour: 15 },
    { name: 'night', u: -4, v: -560, h: 5, tu: 6, tv: -380, th: 6, hour: 21.5 },
  ];
  for (const view of views) {
    await page.evaluate(async (vw) => {
      const { city, engine } = window.__xarita;
      const x = city.xalqlar, eye = x.basis.point(vw.u, vw.v), target = x.basis.point(vw.tu, vw.tv);
      await city.teleport(eye.x, eye.z);
      city.clock.setCityHour(vw.hour);
      city.paused = false;
      city.update({ dt: 0, elapsed: 1, frame: 100 });
      city.paused = true;
      eye.y = city.ground.heightAt(eye.x, eye.z) + vw.h;
      target.y = city.ground.heightAt(target.x, target.z) + vw.th;
      for (const tile of city.tiles.values()) tile.updateDetails(eye);
      city.sky.update(city.clock.now(), 40.0942, 65.3791, eye);
      engine.camera.position.copy(eye);
      engine.camera.lookAt(target);
      engine.camera.fov = 70;
      engine.camera.far = 6000;
      engine.camera.updateProjectionMatrix();
      city.sky.dome.position.copy(eye);
      engine.renderer.render(engine.scene, engine.camera);
    }, view);
    await page.waitForFunction(() => !window.__xarita.city.teleporting, null, { timeout: 90000 });
    await page.screenshot({ path: `artifacts/xalqlar-${view.name}.png` });
  }

  assert.equal(data.invalid, 0, 'avenue geometry must be finite');
  assert.equal(data.overlappingGeneric, 0, 'the generic tile must not redraw Sport Saroyi');
  assert.ok(Math.abs(data.road) < .15, `carriageway surface and collider must agree (${data.road})`);
  assert.ok(data.median > .12 && data.median < .3, `median collider height ${data.median}`);
  assert.ok(data.trees > 600, 'measured tree rows must be planted');
  assert.ok(data.grounded, 'visit button must land the player on the ground');
  assert.ok(Math.abs(data.coords.v + 760) < 60, 'visit button should land on the avenue by the mall');
  assert.deepEqual(errors, []);
  console.log("PASS: Xalqlar Do'stligi avenue, landmarks, colliders, day/night");
} finally {
  await browser.close();
}
