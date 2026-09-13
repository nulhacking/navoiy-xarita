/**
 * Personaj va transport uchun bepul 3D modellarni yuklab oladi.
 *
 * Manba — Khronos glTF-Sample-Assets: rasmiy, barqaror va litsenziyasi
 * hujjatlangan to'plam. Ikkala model ham **CC BY 4.0**, ya'ni ishlatish
 * bepul, lekin ATRIBUT MAJBURIY — u ekranda ko'rsatiladi (`Hud.tsx`) va
 * shu yerdagi `LICENSE.md` ga yoziladi.
 *
 * Ishlatish:  node tools/models/fetch.mjs
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, '../../apps/client/public/models');
const BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

const MODELS = [
  {
    file: 'character.glb',
    url: `${BASE}/CesiumMan/glTF-Binary/CesiumMan.glb`,
    name: 'CesiumMan',
    credit: '© 2017 Cesium — CC BY 4.0',
    note: 'Yurish animatsiyasi bilan odam modeli.',
  },
  {
    file: 'car.glb',
    url: `${BASE}/CarConcept/glTF-Binary/CarConcept.glb`,
    name: 'CarConcept',
    credit: '© 2024 Darmstadt Graphics Group GmbH — CC BY 4.0 (asos: Unity Fan, CC0)',
    note: 'Yengil avtomobil. G‘ildiraklari alohida tugunlarda.',
  },
];

await mkdir(OUT_DIR, { recursive: true });

for (const model of MODELS) {
  const target = join(OUT_DIR, model.file);
  const existing = await stat(target).catch(() => null);
  if (existing) {
    console.log(`[models] allaqachon bor: ${model.file} (${mb(existing.size)})`);
    continue;
  }

  console.log(`[models] ${model.name} yuklanmoqda…`);
  const response = await fetch(model.url);
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText} — ${model.url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  const written = await stat(target);
  console.log(`[models] tayyor: ${model.file} (${mb(written.size)})`);
}

// Litsenziya faylini modellar yonida saqlaymiz — ular ko'chirilsa ham
// atribut yo'qolmasin.
const license = [
  '# Modellar va litsenziyalar',
  '',
  'Bu papkadagi modellar Khronos glTF-Sample-Assets to‘plamidan olingan.',
  'Ikkalasi ham **CC BY 4.0** — foydalanish bepul, atribut majburiy.',
  '',
  ...MODELS.flatMap((m) => [
    `## ${m.file} — ${m.name}`,
    '',
    m.note,
    '',
    `- ${m.credit}`,
    `- Manba: ${m.url}`,
    '',
  ]),
  'Atribut ilova ekranida ham ko‘rsatiladi.',
  '',
].join('\n');
await writeFile(join(OUT_DIR, 'LICENSE.md'), license);
console.log('[models] LICENSE.md yozildi');

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
