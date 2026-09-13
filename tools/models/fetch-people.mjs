import { mkdir, writeFile, stat } from 'node:fs/promises';
const folder = new URL('../../apps/client/public/models/', import.meta.url);
await mkdir(folder, { recursive: true });
const entries = [
  { file: 'woman.glb', title: 'Animated Woman', page: 'https://poly.pizza/m/nIItLV9nxS' },
  { file: 'man.glb', title: 'Man', page: 'https://poly.pizza/m/HMnuH5geEG' },
  // Ko'chada bir xil odam takrorlanmasin: bir nechta kiyim-bosh. Hammasi
  // Quaternius CC0 va o'sha suyak nomlariga ega, shuning uchun `Rider`
  // ularni ham transportga o'tqaza oladi.
  { file: 'businessman.glb', title: 'Business Man', page: 'https://poly.pizza/m/JFrLIKqvCH' },
  { file: 'woman-dress.glb', title: 'Woman in Dress', page: 'https://poly.pizza/m/zMyPlQXBzq' },
  { file: 'woman-tanktop.glb', title: 'Woman in Tank Top', page: 'https://poly.pizza/m/XqzeZGB7iU' },
];
for (const entry of entries) {
  const target = new URL(entry.file, folder);
  if (await stat(target).catch(() => null)) continue;
  const response = await fetch(entry.page);
  if (!response.ok) throw new Error(`Listing: ${response.status}`);
  const html = await response.text();
  if (!html.includes('CC0')) throw new Error('CC0 license missing from listing');
  const url = html.match(/https:\/\/static\.poly\.pizza\/[^\s"<>\\]+\.glb/)?.[0];
  if (!url) throw new Error(`GLB link missing: ${entry.page}`);
  const download = await fetch(url);
  if (!download.ok) throw new Error(`Asset: ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  if (!gltf.animations?.some(a => /walk/i.test(a.name))) throw new Error('Walking animation missing');
  await writeFile(target, bytes, { flag: 'wx' });
  await writeFile(new URL(`${entry.file}.LICENSE.txt`, folder), `${entry.title} by Quaternius\nCC0 1.0 Universal\n${entry.page}\nhttps://creativecommons.org/publicdomain/zero/1.0/\n${url}\nHeight normalization and independent skeletons at runtime. Low-poly, not photogrammetry.\n`);
  console.log(entry.file, bytes.length, gltf.animations.map(a => a.name));
}
