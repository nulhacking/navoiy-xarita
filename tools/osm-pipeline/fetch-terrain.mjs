import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
const root = new URL('../../apps/client/public/', import.meta.url);
const { bbox: [south, west, north, east] } = JSON.parse(await readFile(new URL('osm/index.json', root), 'utf8'));
const zoom = 12, n = 2 ** zoom;
const mx = lon => (lon + 180) / 360;
const my = lat => { const s = Math.sin(lat * Math.PI / 180); return .5 - Math.log((1+s)/(1-s))/(4*Math.PI); };
let count = 0;
for (let x = Math.floor(mx(west)*n); x <= Math.floor(mx(east)*n); x++) {
  const folder = new URL(`terrain/${zoom}/${x}/`, root); await mkdir(folder, { recursive: true });
  for (let y = Math.floor(my(north)*n); y <= Math.floor(my(south)*n); y++) {
    const target = new URL(`${y}.png`, folder);
    if (!await stat(target).catch(() => null)) {
      const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Terrain ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid terrain PNG');
      await writeFile(target, bytes, { flag: 'wx' });
    }
    count++;
  }
}
console.log(`${count} local DEM tiles ready. Source: AWS Terrain Tiles (SRTM, NED, GMTED).`);
