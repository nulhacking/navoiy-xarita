import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
const folder = new URL('../../apps/client/public/models/', import.meta.url);
await mkdir(folder, { recursive: true });
const entries = [
  ['sedan', 'Cz6yDaUcM9', 'Car', 'Quaternius', 'CC0'],
  ['suv', 'xsMtZhBkxL', 'SUV', 'Quaternius', 'CC0'],
  ['motorcycle', '1yfyze7uGxS', 'Suzuki SV650', 'Paul Spooner', 'CC-BY'],
  ['bicycle', 'axc03j3xKfz', 'Bicycle', 'jeremy', 'CC-BY'],
  ['tree-broad', 'qZtx0AHhcy', 'Tree', 'Quaternius', 'CC0'],
  ['tree-pine', 'Zt62gceKXZ', 'Pine', 'Quaternius', 'CC0'],
  ['air-conditioner', '4m3lja-ZCkA', 'Air conditioner', 'Poly by Google', 'CC-BY'],
  ['bench', 'dOSjmdmKaxi', 'Bench', 'Ev Amitay', 'CC-BY'],
  ['street-lamp', '7JUgLfLeEU', 'Light Post', 'Zsky', 'CC-BY'],
  ['woman-casual', 'jpKRgGDxhk', 'Woman Casual', 'Quaternius', 'CC0'],
  ['worker', 'Yg2bQZO6Hj', 'Worker', 'Quaternius', 'CC0'],
];
for (const [file, id, title, author, licence] of entries) {
  const target = new URL(`${file}.glb`, folder), page = `https://poly.pizza/m/${id}`;
  if (!(await stat(target).catch(() => null))) {
    const response = await fetch(page);
    if (!response.ok) throw new Error(`${page}: ${response.status}`);
    const html = await response.text();
    if (!html.includes(licence === 'CC0' ? 'CC0' : 'Creative Commons Attribution')) throw new Error(`License missing: ${page}`);
    const url = html.match(/https:\/\/static\.poly\.pizza\/[^\s"<>\\]+\.glb/)?.[0];
    if (!url) throw new Error(`GLB missing: ${page}`);
    const download = await fetch(url);
    if (!download.ok) throw new Error(`${url}: ${download.status}`);
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB');
    await writeFile(target, bytes, { flag: 'wx' });
    const licenseUrl = licence === 'CC0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/3.0/';
    await writeFile(new URL(`${file}.glb.LICENSE.txt`, folder), `${title} by ${author}\n${licence}\n${page}\n${licenseUrl}\n${url}\nRuntime normalization, wheel rig and rider pose added.\n`);
  }
  const bytes = await readFile(target);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  console.log(file, bytes.length, JSON.stringify(gltf.nodes?.map((n,i)=>({i,name:n.name,mesh:n.mesh,children:n.children}))), 'materials', gltf.materials?.map(m=>m.name));
}
