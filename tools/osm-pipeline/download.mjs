/**
 * Geofabrik'dan OSM ekstraktini yuklab oladi.
 *
 * Nima uchun aynan shu yo'l: OSM ma'lumotini bulk olishning sanksiyalangan
 * usuli shu. Rasmiy OSM API 0.6 bulk yuklashni taqiqlaydi, Overpass esa
 * `out geom` so'rovlarida ishonchsiz (uchta mirrorda ham timeout bergan).
 *
 * Ishlatish:
 *   node tools/osm-pipeline/download.mjs [region]
 *   node tools/osm-pipeline/download.mjs asia/uzbekistan     (standart)
 *
 * Uzilib qolgan yuklash keyingi ishga tushirishda davom ettiriladi (HTTP Range).
 */
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, 'data');

/** Standart ekstrakt — loyihaning asosiy hududi. */
export const DEFAULT_REGION = 'asia/uzbekistan';

export function extractPathFor(region = DEFAULT_REGION) {
  return join(DATA_DIR, `${region.replace(/\//g, '-')}-latest.osm.pbf`);
}

/**
 * Yuklab oladi va to'liq faylning yo'lini qaytaradi.
 *
 * DIQQAT: hudud parametr sifatida uzatiladi, `process.argv` dan O'QILMAYDI.
 * Avval argv modul darajasida o'qilar edi va `bake.mjs navoiy` ni ishga
 * tushirganda bu modul "navoiy" ni Geofabrik hududi deb qabul qilib,
 * 404 sahifasini `.pbf` sifatida saqlab qo'yardi.
 */
export async function download(region = DEFAULT_REGION) {
  const target = extractPathFor(region);
  const source = `https://download.geofabrik.de/${region}-latest.osm.pbf`;
  await mkdir(dirname(target), { recursive: true });

  const existing = await stat(target).catch(() => null);
  if (existing) {
    console.log(`[download] allaqachon bor: ${target} (${mb(existing.size)})`);
    return target;
  }

  // Qisman fayl `.part` da to'planadi — to'liq bo'lgach nomi almashadi.
  // Shunda yarim yuklangan faylni "tayyor" deb o'ylab qolish ehtimoli yo'q.
  const partial = `${target}.part`;
  const done = await stat(partial).catch(() => null);
  const offset = done?.size ?? 0;

  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : undefined;
  const response = await fetch(source, headers ? { headers } : undefined);

  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText} — ${source}`);
  }
  // Server Range'ni qo'llab-quvvatlamasa (206 emas, 200) — boshidan yozamiz.
  const resuming = offset > 0 && response.status === 206;
  const total = Number(response.headers.get('content-length') ?? 0) + (resuming ? offset : 0);

  if (offset > 0 && !resuming) {
    console.log('[download] server davom ettirishni qo\'llamadi, boshidan yuklanadi');
  }
  console.log(`[download] ${source}`);
  console.log(`[download] hajmi ${mb(total)}${resuming ? `, ${mb(offset)} dan davom` : ''}`);

  let received = resuming ? offset : 0;
  let lastReport = Date.now();
  const started = Date.now();

  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length;
      if (Date.now() - lastReport > 2000) {
        lastReport = Date.now();
        const pct = total ? ((received / total) * 100).toFixed(1) : '?';
        const speed = (received - (resuming ? offset : 0)) / ((Date.now() - started) / 1000);
        console.log(`[download] ${pct}%  ${mb(received)} / ${mb(total)}  (${mb(speed)}/s)`);
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(progress)),
    createWriteStream(partial, { flags: resuming ? 'a' : 'w' }),
  );

  await assertPbf(partial);
  await rename(partial, target);
  console.log(`[download] tayyor: ${target} (${mb(received)})`);
  return target;
}

/**
 * Fayl haqiqatan OSM PBF ekanini tekshiradi.
 *
 * Geofabrik noto'g'ri hudud nomiga 404 HTML sahifasi qaytaradi, va uni
 * jimgina `.pbf` deb saqlab qo'yish keyinroq protobuf ichida tushunarsiz
 * xatoga aylanadi. Xatoni manbada ushlash ancha aniqroq.
 */
async function assertPbf(path) {
  const handle = await open(path, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(14), 0, 14, 0);
    // Har bir PBF fayl 4 baytlik BlobHeader uzunligi bilan boshlanadi,
    // undan keyin darhol "OSMHeader" satri turadi.
    if (!buffer.subarray(4).includes('OSMHeader')) {
      throw new Error(
        `Yuklangan fayl OSM PBF emas (boshi: ${JSON.stringify(buffer.toString('latin1'))}). ` +
          'Hudud nomi xato bolishi mumkin — https://download.geofabrik.de/ ro\'yxatiga qarang.',
      );
    }
  } finally {
    await handle.close();
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Argumentlar FAQAT bu fayl to'g'ridan-to'g'ri ishga tushirilganda o'qiladi.
// Import qilinganda `process.argv` chaqiruvchiga tegishli bo'ladi.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await download(process.argv[2] ?? DEFAULT_REGION);
}
