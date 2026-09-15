/** Rebind Blender exports to game axes, share LOD bones, attach animation clips. */
import { chromium } from 'playwright-core';
import { existsSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
const ids=process.argv.slice(2).length?process.argv.slice(2):['yigit','qiz','ishbilarmon','ishchi'];
mkdirSync('artifacts/blender-work/packed',{recursive:true});
try {
  const page=await browser.newPage();
  page.on('console',m=>{if(m.type()==='log')console.log(m.text());});
  await page.route('**/authoring',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('http://localhost:5173/authoring');
  await page.exposeFunction('savePacked',(id,bytes)=>writeFileSync(`artifacts/blender-work/packed/${id}.glb`,Buffer.from(bytes,'base64')));
  const report=await page.evaluate(async({ids,root})=>{
    const {T,GLTFExporter,makeAnimations}=await import(`${root}/tools/models/reference-characters.mjs`);
    const {createGltfLoader}=await import('/src/city/GltfLoader.ts');
    const {locomotionClips}=await import(`${root}/tools/models/mocap-animations.mjs`);
    const loader=createGltfLoader(),report=[];
    for(const id of ids){
      const source=await loader.loadAsync(`${root}/artifacts/blender-work/${id}-raw.glb`);
      const far=await loader.loadAsync(`${root}/artifacts/blender-work/${id}-lod.glb`);
      const object=new T.Group();object.name=`Xarita_${id}`;object.userData={avatarId:id,referenceModel:true,modelMethod:'Blender / MakeHuman CC0',lodDistance:24};
      source.scene.updateMatrixWorld(true);far.scene.updateMatrixWorld(true);
      const sourceBones=[];source.scene.traverse(n=>{if(n.isBone)sourceBones.push(n);});
      const bones=new Map(),rest={};
      for(const b of sourceBones){const node=new T.Bone();node.name=b.name;node.position.copy(b.getWorldPosition(new T.Vector3()));rest[node.name]=node.position.toArray();bones.set(node.name,node);}
      for(const original of sourceBones){const b=bones.get(original.name),parent=original.parent?.isBone?bones.get(original.parent.name):null;if(parent){b.position.sub(new T.Vector3(...rest[parent.name]));parent.add(b);}else object.add(b);}
      const materialMap=new Map();let highTriangles=0,lowTriangles=0;
      for(const [level,gltf] of [[0,source],[1,far]]){
        const group=new T.Group();group.name=`LOD${level}`;group.userData.lodLevel=level;group.visible=level===0;object.add(group);
        const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
        for(const old of meshes){
          const g=old.geometry.clone().applyMatrix4(old.matrixWorld);
          const materials=(Array.isArray(old.material)?old.material:[old.material]).map(mat=>{
            if(materialMap.has(mat.name))return materialMap.get(mat.name);
            const m=mat.clone();m.roughness=Math.max(m.roughness,.65);m.metalness=0;
            m.transparent=false;m.opacity=1;m.depthWrite=true;m.alphaTest=0;m.side=T.FrontSide;
            if(/short|ponytail|eyebrow|eyelash/i.test(mat.name)){m.alphaTest=.35;m.transparent=false;m.depthWrite=true;m.side=T.DoubleSide;m.roughness=.86;if(/ponytail/i.test(mat.name))m.color.multiply(new T.Color(.14,.09,.055));}
            if(/body|caucasian|skin|detailed/i.test(mat.name)){m.color.multiply(new T.Color(.88,.79,.71));m.roughness=.67;}
            if(id==='yigit'&&/shoes/i.test(mat.name))m.color.multiply(new T.Color(.45,.075,.12));
            if(id==='ishbilarmon'&&/short02/i.test(mat.name))m.color.multiply(new T.Color(.36,.31,.27));
            materialMap.set(mat.name,m);return m;
          });
          const mesh=new T.SkinnedMesh(g,Array.isArray(old.material)?materials:materials[0]);mesh.name=`${old.name}_LOD${level}`;
          group.add(mesh);object.updateMatrixWorld(true);
          mesh.bind(new T.Skeleton(old.skeleton.bones.map(b=>bones.get(b.name))));mesh.normalizeSkinWeights();mesh.castShadow=true;
          const tris=(g.index?.count??g.attributes.position.count)/3;if(level===0)highTriangles+=tris;else lowTriangles+=tris;
        }
      }
      object.updateMatrixWorld(true);
      const height={yigit:1.8,qiz:1.7,ishbilarmon:1.78,ishchi:1.83}[id];
      const actualHeight=new T.Box3().setFromObject(object.getObjectByName('LOD0')).getSize(new T.Vector3()).y;
      const animations=makeAnimations([...bones.values()],rest,actualHeight).filter(c=>!['Walk','Run'].includes(c.name));
      animations.push(...await locomotionClips(object,[...bones.values()],rest,root));
      const scale=height/actualHeight;object.scale.setScalar(scale);
      object.userData.walkSpeed*=scale;object.userData.runSpeed*=scale;
      // Extra finger bones retain their authored rest. Every clip is reusable by NPCs.
      const bytes=await new GLTFExporter().parseAsync(object,{binary:true,animations,onlyVisible:false});
      const array=new Uint8Array(bytes);let binary='';for(let j=0;j<array.length;j+=32768)binary+=String.fromCharCode(...array.subarray(j,j+32768));
      await window.savePacked(id,btoa(binary));report.push({id,highTriangles,lowTriangles,bones:bones.size,bytes:array.length});
    }return report;
  },{ids,root:`/@fs/${resolve('.').replaceAll('\\','/')}`});
  console.log(JSON.stringify(report,null,2));writeFileSync('artifacts/blender-work/geometry-report.json',JSON.stringify(report,null,2));
}finally{await browser.close();}
