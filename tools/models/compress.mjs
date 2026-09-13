/**
 * `public/models/*.glb` ni joyida siqadi (fetch skriptlaridan keyin bir marta).
 *
 *   node tools/models/compress.mjs
 *
 * Faqat strukturani saqlaydigan bosqichlar: kod tugun, material va suyak
 * nomlariga tayanadi (g'ildirak yig'malari, "Windows" materiali, animatsiya
 * kliplari), shuning uchun `optimize` dagi join/flatten/instance/simplify
 * ATAYLAB ishlatilmaydi.
 *   dedup  — faqat bir xil accessor va teksturalar (material/mesh emas)
 *   prune  — bo'sh tugunlar va atributlar saqlanadi
 *   resize — teksturalar ≤ 1024 px
 *   webp   — EXT_texture_webp, sifat 88
 *   meshopt — EXT_meshopt_compression (brauzerda `GltfLoader.ts` dekodlaydi)
 *
 * Qayta siqish zarar qilmaydi, lekin sifat har safar biroz tushadi —
 * asl fayllardan boshlash afzal.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = join(dirname(fileURLToPath(import.meta.url)), '../../apps/client/public/models');
const CLI = '@gltf-transform/cli@4';
const work = mkdtempSync(join(tmpdir(), 'xarita-models-'));
const run = (...args) => execFileSync('npx', ['--yes', CLI, ...args], { stdio: 'pipe', shell: process.platform === 'win32' });

let before = 0, after = 0;
try {
  for (const name of readdirSync(MODELS).filter((f) => f.endsWith('.glb'))) {
    const source = join(MODELS, name), step = (i) => join(work, `${i}-${name}`);
    const size = statSync(source).size;
    run('dedup', source, step(1), '--materials', 'false', '--meshes', 'false');
    run('prune', step(1), step(2), '--keep-leaves', 'true', '--keep-attributes', 'true');
    run('resize', step(2), step(3), '--width', '1024', '--height', '1024');
    run('webp', step(3), step(4), '--quality', '88');
    run('meshopt', step(4), step(5), '--level', 'medium');
    renameSync(step(5), source);
    before += size; after += statSync(source).size;
    console.log(`${name.padEnd(22)} ${(size / 1024).toFixed(0).padStart(7)} KB -> ${(statSync(source).size / 1024).toFixed(0).padStart(6)} KB`);
  }
  console.log(`jami: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
