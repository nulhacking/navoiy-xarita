import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Author's CC0 listing: https://poly.pizza/m/kZ3DmIoGip
const url = 'https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb';
const folder = new URL('../../apps/client/public/models/', import.meta.url);
const target = new URL('casual.glb', folder);
await mkdir(folder, { recursive: true });
if (!await stat(target).catch(() => null)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Invalid GLB');
  await writeFile(target, bytes, { flag: 'wx' });
}
await writeFile(new URL('CASUAL-LICENSE.txt', folder),
  'Casual Character by Quaternius\nCC0 1.0 Universal (Public Domain)\n' +
  'Source: https://poly.pizza/m/kZ3DmIoGip\n' +
  'License: https://creativecommons.org/publicdomain/zero/1.0/\n' +
  `Model: ${url}\nRuntime modifications: height normalization, independent animation skeletons.\n`);
console.log(fileURLToPath(target));
