/**
 * OSM PBF formatini o'qish — sof Node, native toolchain kerak emas.
 *
 * NIMA UCHUN O'ZIMIZ YOZDIK: npm'dagi barcha OSM PBF parserlari 2022 dan beri
 * yangilanmagan. Format esa 2010 dan beri o'zgarmagan va to'liq hujjatlangan,
 * shuning uchun uni o'qish uchun bizga kerak bo'lgani atigi protobuf (`pbf`)
 * va Node'ning o'z `zlib` i. Bu 4 yillik bog'liqlikdan ko'ra ishonchliroq.
 *
 * Format (osmformat.proto / fileformat.proto):
 *   fayl = bloklar ketma-ketligi
 *   blok = [4 bayt BE: BlobHeader uzunligi][BlobHeader][Blob]
 *   BlobHeader { type = 1 (string), datasize = 3 (int32) }
 *   Blob { raw = 1, raw_size = 2, zlib_data = 3, ... }
 *   type "OSMHeader" — meta; "OSMData" — PrimitiveBlock
 *
 * Koordinatalar butun son sifatida saqlanadi:
 *   daraja = 1e-9 * (offset + granularity * qiymat)
 */
import { inflateSync } from 'node:zlib';

import Pbf from 'pbf';

/** Nanograduslardan gradusga — PBF ning standart koeffitsienti. */
const NANO = 1e-9;

function readBlobHeader(buffer) {
  const pbf = new Pbf(buffer);
  const header = { type: '', datasize: 0 };
  pbf.readFields(
    (tag, out, p) => {
      if (tag === 1) out.type = p.readString();
      else if (tag === 3) out.datasize = p.readVarint();
    },
    header,
  );
  return header;
}

function readBlob(buffer) {
  const pbf = new Pbf(buffer);
  const blob = { raw: null, zlib: null };
  pbf.readFields(
    (tag, out, p) => {
      if (tag === 1) out.raw = p.readBytes();
      else if (tag === 3) out.zlib = p.readBytes();
    },
    blob,
  );

  if (blob.raw) return Buffer.from(blob.raw);
  if (blob.zlib) return inflateSync(Buffer.from(blob.zlib));
  throw new Error('Blob siqilishi qo\'llab-quvvatlanmaydi (zlib yoki raw kutilgan)');
}

function readStringTable(pbf, end) {
  const table = [];
  // StringTable { repeated bytes s = 1 }
  pbf.readFields(
    (tag, out, p) => {
      if (tag === 1) out.push(p.readString());
    },
    table,
    end,
  );
  return table;
}

function readDenseNodes(pbf, end) {
  const dense = { id: [], lat: [], lon: [], keysVals: [] };
  pbf.readFields(
    (tag, out, p) => {
      if (tag === 1) p.readPackedSVarint(out.id);
      else if (tag === 8) p.readPackedSVarint(out.lat);
      else if (tag === 9) p.readPackedSVarint(out.lon);
      else if (tag === 10) p.readPackedVarint(out.keysVals);
    },
    dense,
    end,
  );
  return dense;
}

function readWay(pbf, end) {
  const way = { id: 0, keys: [], vals: [], refs: [] };
  pbf.readFields(
    (tag, out, p) => {
      if (tag === 1) out.id = p.readVarint();
      else if (tag === 2) p.readPackedVarint(out.keys);
      else if (tag === 3) p.readPackedVarint(out.vals);
      else if (tag === 8) p.readPackedSVarint(out.refs);
    },
    way,
    end,
  );
  return way;
}

/**
 * PrimitiveBlock ni o'qib, `handlers` ni chaqiradi.
 *
 * @param {Buffer} buffer  siqilishdan chiqarilgan blok
 * @param {{ node?: (id, lat, lon, tags) => void, way?: (id, refs, tags) => void }} handlers
 */
function readPrimitiveBlock(buffer, handlers) {
  const pbf = new Pbf(buffer);
  let stringTable = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  // Guruhlar `stringtable` dan keyin kelishi kafolatlanmagan, shuning uchun
  // avval meta maydonlarni yig'ib, guruhlarni ikkinchi o'tishda o'qiymiz.
  const groupRanges = [];

  pbf.readFields((tag, _out, p) => {
    if (tag === 1) {
      stringTable = readStringTable(p, p.readVarint() + p.pos);
    } else if (tag === 2) {
      const end = p.readVarint() + p.pos;
      groupRanges.push([p.pos, end]);
      p.pos = end;
    } else if (tag === 17) {
      granularity = p.readVarint();
    } else if (tag === 19) {
      latOffset = p.readVarint();
    } else if (tag === 20) {
      lonOffset = p.readVarint();
    }
    // Boshqa maydonlarni `readFields` o'zi o'tkazib yuboradi: callback `pos` ni
    // qimirlatmasa, u to'liq `val` bilan `skip()` chaqiradi. Bu yerda qo'lda
    // `skip(tag)` yozish xato bo'lardi — `skip` wire-type ni qiymatning
    // quyi 3 bitidan oladi, tag raqamidan emas.
  });

  const toLat = (value) => NANO * (latOffset + granularity * value);
  const toLon = (value) => NANO * (lonOffset + granularity * value);

  for (const [start, end] of groupRanges) {
    pbf.pos = start;
    readPrimitiveGroup(pbf, end, stringTable, toLat, toLon, handlers);
  }
}

function readPrimitiveGroup(pbf, groupEnd, stringTable, toLat, toLon, handlers) {
  while (pbf.pos < groupEnd) {
    const value = pbf.readVarint();
    const tag = value >> 3;

    if (tag === 2 && handlers.node) {
      // DenseNodes — nodelarning 99% i shu shaklda keladi.
      const end = pbf.readVarint() + pbf.pos;
      const dense = readDenseNodes(pbf, end);
      emitDenseNodes(dense, stringTable, toLat, toLon, handlers.node);
    } else if (tag === 3 && handlers.way) {
      const end = pbf.readVarint() + pbf.pos;
      const way = readWay(pbf, end);
      handlers.way(way.id, decodeRefs(way.refs), buildTags(way.keys, way.vals, stringTable));
    } else {
      pbf.skip(value);
    }
  }
}

function emitDenseNodes(dense, stringTable, toLat, toLon, onNode) {
  const { id, lat, lon, keysVals } = dense;
  let currentId = 0;
  let currentLat = 0;
  let currentLon = 0;
  let kvIndex = 0;

  for (let i = 0; i < id.length; i++) {
    // Uchala massiv ham delta kodlangan.
    currentId += id[i];
    currentLat += lat[i];
    currentLon += lon[i];

    // keys_vals — yassi ro'yxat: har node uchun (kalit, qiymat) juftliklari,
    // 0 bilan tugaydi. Node'da teg bo'lmasa, bitta 0 turadi.
    let tags = null;
    if (kvIndex < keysVals.length) {
      while (keysVals[kvIndex] !== 0) {
        const key = stringTable[keysVals[kvIndex++]];
        const value = stringTable[keysVals[kvIndex++]];
        (tags ??= {})[key] = value;
      }
      kvIndex++; // tugatuvchi nolni o'tkazamiz
    }

    onNode(currentId, toLat(currentLat), toLon(currentLon), tags);
  }
}

/** Way'ning node ro'yxati delta kodlangan. */
function decodeRefs(refs) {
  const result = new Array(refs.length);
  let current = 0;
  for (let i = 0; i < refs.length; i++) {
    current += refs[i];
    result[i] = current;
  }
  return result;
}

function buildTags(keys, vals, stringTable) {
  if (keys.length === 0) return null;
  const tags = {};
  for (let i = 0; i < keys.length; i++) {
    tags[stringTable[keys[i]]] = stringTable[vals[i]];
  }
  return tags;
}

/**
 * Butun faylni o'qib chiqadi.
 *
 * Fayl to'liq xotiraga o'qiladi (O'zbekiston ekstrakti ~118 MB — bu Node
 * uchun arzimas) — oqim bilan o'qishga qaraganda ancha sodda va tezroq.
 *
 * OSM PBF da tartib kafolatlangan: avval barcha node'lar, keyin way'lar.
 * Shuning uchun bitta o'tishda node xaritasini qurib, way'lar kelganda
 * ularni darhol yechish mumkin.
 */
export function readOsmPbf(buffer, handlers, onProgress) {
  let offset = 0;
  let blocks = 0;

  while (offset + 4 <= buffer.length) {
    const headerLength = buffer.readUInt32BE(offset);
    offset += 4;

    // Sog'lomlik tekshiruvi: BlobHeader hech qachon bir necha yuz baytdan
    // oshmaydi. Katta qiymat — offset siljib ketgani belgisi, va uni shu
    // yerda ushlash protobuf ichida tushunarsiz xato olishdan yaxshiroq.
    if (headerLength === 0 || headerLength > 64 * 1024) {
      throw new Error(
        `Blok ${blocks}: BlobHeader uzunligi ishonchsiz (${headerLength}) — ` +
          `offset ${offset - 4} da fayl buzilgan yoki o'qish siljigan`,
      );
    }

    const header = readBlobHeader(buffer.subarray(offset, offset + headerLength));
    offset += headerLength;

    const blobEnd = offset + header.datasize;
    if (blobEnd > buffer.length) {
      throw new Error(`Fayl kesilgan: blok ${blocks} to'liq emas`);
    }

    if (header.type === 'OSMData') {
      readPrimitiveBlock(readBlob(buffer.subarray(offset, blobEnd)), handlers);
    }

    offset = blobEnd;
    blocks++;
    if (onProgress && blocks % 200 === 0) onProgress(offset / buffer.length, blocks);
  }

  return blocks;
}
