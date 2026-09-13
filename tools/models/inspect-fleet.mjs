import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Vector3, Mesh } from 'three';
globalThis.ProgressEvent ??= class ProgressEvent {};
for (const name of ['sedan','suv','motorcycle','bicycle']) {
  const b = await readFile(`apps/client/public/models/${name}.glb`);
  const g = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  g.scene.updateMatrixWorld(true);
  console.log('\n'+name, new Box3().setFromObject(g.scene));
  g.scene.traverse(n=>{
    if (!(n instanceof Mesh)) return;
    const box = new Box3().setFromObject(n), size=box.getSize(new Vector3()), center=box.getCenter(new Vector3());
    console.log(n.name,n.material.name, 'size',size.toArray().map(v=>+v.toFixed(3)), 'center',center.toArray().map(v=>+v.toFixed(3)));
  });
}
