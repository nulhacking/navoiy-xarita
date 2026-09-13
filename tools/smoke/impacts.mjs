import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));

const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__xarita?.city.isReady, null, { timeout: 180000 });
  await page.evaluate(() => window.__xarita.engine.stop());
  mkdirSync('artifacts', { recursive: true });

  // Sahna tayyorlash: Xalqlar Do'stligi trotuaridagi chiroq va daraxt yonida mashinani haydash.
  const data = await page.evaluate(async () => {
    const { city } = window.__xarita;
    const props = city.breakables.registry;
    const player = city.player, x = city.xalqlar;
    const tick = (n) => { for (let i = 0; i < n; i++) city.update({ dt: 1 / 60, elapsed: i / 60, frame: i }); };
    const place = (u, v, yaw, speed) => {
      const p = x.basis.point(u, v);
      const y = city.ground.heightAt(p.x, p.z) + player.spec.half.y + .05;
      player.mode = 'drive'; player.body.setEnabled(false);
      player.carPosition.set(p.x, y, p.z); player.carYaw = yaw; player.carSpeed = speed;
      player.carBody.setTranslation(player.carPosition, true); player.carBody.setNextKinematicTranslation(player.carPosition);
      city.physics.world.updateSceneQueries();
    };
    const nearest = (kind, point) => {
      let best = null, bestD = Infinity;
      props.near(point.x, point.z, 40, (prop) => {
        if (prop.kind !== kind) return;
        const d = Math.hypot(prop.x - point.x, prop.z - point.z);
        if (d < bestD) { bestD = d; best = prop; }
      });
      return best;
    };
    await city.teleport(x.basis.point(0, -400).x, x.basis.point(0, -400).z);
    tick(10);
    const avenueYaw = Math.atan2(x.basis.south.x, x.basis.south.z);
    const result = { registered: props.size };

    // 1. Sekin tegish: chiroq buzilmaydi, mashina ichiga kirmaydi.
    const slowLamp = nearest('lamp', x.basis.point(18.65, -430));
    const slowUV = x.basis.uv(slowLamp);
    place(slowUV.u + 1.2, slowUV.v - 4, avenueYaw, 1);
    tick(120);
    const carUV = x.basis.uv(player.carPosition);
    result.slow = { broken: slowLamp.broken, gap: Math.hypot(player.carPosition.x - slowLamp.x, player.carPosition.z - slowLamp.z) };

    // 2. Tez urilish: chiroq yiqiladi, mashina sekinlashadi.
    const lamp = nearest('lamp', x.basis.point(18.65, -470));
    const lampUV = x.basis.uv(lamp);
    place(lampUV.u + .8, lampUV.v - 8, avenueYaw, 16);
    tick(40);
    result.fast = { broken: lamp.broken, speedAfter: player.carSpeed, active: city.breakables.activeBodies };
    tick(120);
    const debris = city.breakables.group.children.at(-1);
    result.fast.debrisMoved = debris ? Math.hypot(debris.children[0].matrix.elements[12] - lamp.x, debris.children[0].matrix.elements[14] - lamp.z) : 0;

    // 3. Daraxt.
    const tree = nearest('tree', x.basis.point(20.8, -300));
    const treeUV = x.basis.uv(tree);
    place(treeUV.u, treeUV.v - 8, avenueYaw, 18);
    tick(40);
    result.tree = { broken: tree.broken };

    // 4. Piyoda daraxtga yurib kiradi — itariladi.
    const walkTree = nearest('tree', x.basis.point(20.8, -520));
    player.mode = 'walk'; player.body.setEnabled(true);
    const start = { x: walkTree.x, y: city.ground.heightAt(walkTree.x, walkTree.z) + 1.2, z: walkTree.z };
    player.body.setTranslation(start, true); player.body.setNextKinematicTranslation(start);
    city.physics.world.updateSceneQueries();
    tick(20);
    const t = player.body.translation();
    result.walker = { gap: Math.hypot(t.x - walkTree.x, t.z - walkTree.z), need: walkTree.radius };

    // 5. NPC: eng yaqin piyodani mashina bilan urib yuborish.
    tick(60);
    const agents = city.traffic.agents;
    const target = agents.find((a) => a.pedestrian) ?? agents[0];
    if (target) {
      const tp = target.body.translation();
      const yaw = Math.random() * Math.PI * 2;
      const back = { x: tp.x - Math.sin(yaw) * 4, z: tp.z - Math.cos(yaw) * 4 };
      const uv = x.basis.uv(back);
      place(uv.u, uv.v, yaw, 14);
      tick(30);
      result.npc = { pedestrian: target.pedestrian, knocked: city.traffic.knocked.length, speedAfter: player.carSpeed };
      tick(60);
      const k = city.traffic.knocked[0];
      result.npc.flew = k ? Math.hypot(k.body.translation().x - tp.x, k.body.translation().z - tp.z) : 0;
    }
    city.paused = true;
    return result;
  });
  console.log(JSON.stringify(data, null, 2));

  await page.evaluate(() => {
    const { city, engine } = window.__xarita;
    const c = city.player.carPosition;
    engine.camera.position.set(c.x - 10, c.y + 6, c.z - 10);
    engine.camera.lookAt(c.x, c.y, c.z);
    engine.renderer.render(engine.scene, engine.camera);
  });
  await page.screenshot({ path: 'artifacts/impacts.png' });

  assert.ok(data.registered > 100, `props must be registered (${data.registered})`);
  assert.ok(!data.slow.broken, 'a slow touch must not break the lamp');
  assert.ok(data.slow.gap > 1, `a slow car must not pass through the lamp (${data.slow.gap})`);
  assert.ok(data.fast.broken, 'a fast hit must topple the lamp');
  assert.ok(data.fast.speedAfter < 16, 'the car must lose speed on impact');
  assert.ok(data.fast.debrisMoved > .5, `the lamp must actually move (${data.fast.debrisMoved})`);
  assert.ok(data.tree.broken, 'a fast hit must topple the tree');
  assert.ok(data.walker.gap >= data.walker.need, 'a walker must be pushed out of a tree');
  if (data.npc) {
    assert.ok(data.npc.knocked > 0, 'a fast car must knock an NPC down');
    assert.ok(data.npc.flew > 1, `the NPC must be thrown (${data.npc.flew})`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: slow touch blocks, fast hits topple lamps/trees, walkers pushed out, NPCs knocked down');
} finally {
  await browser.close();
}
