import {chromium} from 'playwright-core';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage();await page.route('**/authoring',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('http://localhost:5173/authoring');
 await page.exposeFunction('savePacked',(id,bytes)=>writeFileSync(`artifacts/blender-work/packed/${id}.glb`,Buffer.from(bytes,'base64')));
 const report=await page.evaluate(async root=>{
  const {T,GLTFExporter}=await import(`${root}/tools/models/reference-characters.mjs`);
  const {createGltfLoader}=await import('/src/city/GltfLoader.ts');const loader=createGltfLoader(),report=[];
  for(const id of ['sedan','suv']){
   const high=await loader.loadAsync(`${root}/artifacts/blender-work/${id}-raw.glb`),low=await loader.loadAsync(`${root}/artifacts/blender-work/${id}-lod.glb`);
   high.scene.updateMatrixWorld(true);low.scene.updateMatrixWorld(true);
   const object=new T.Group();object.name=`Xarita_${id}`;object.userData={vehicleId:id,referenceModel:true,forward:'+Z',modelMethod:'Blender shaped panels',lodDistance:45};
   const pivots=new Map(),materialMap=new Map(),triangles=[0,0];
   high.scene.traverse(n=>{if(!n.isMesh&&n!==high.scene&&n.name!==object.name){const group=new T.Group();group.name=n.name;group.userData={...n.userData};group.position.copy(n.getWorldPosition(new T.Vector3()));pivots.set(n.name,group);}});
   high.scene.traverse(n=>{const group=pivots.get(n.name);if(!group)return;const parent=pivots.get(n.parent.name);if(parent){group.position.sub(n.parent.getWorldPosition(new T.Vector3()));parent.add(group);}else object.add(group);});object.updateMatrixWorld(true);
   for(const [level,gltf] of [[0,high],[1,low]])gltf.scene.traverse(n=>{
    if(!n.isMesh)return;if(level===1&&(n.userData.brakeLight||n.userData.indicator))return;
    const parent=pivots.get(n.parent.name)??object;
    const geometry=n.geometry.clone().applyMatrix4(n.matrixWorld).applyMatrix4(parent.matrixWorld.clone().invert());
    const mat=n.material,key=mat.name.replace(/\.\d+$/,'');let material=materialMap.get(key);
    if(!material){material=mat.clone();material.name=key;
     if(['Windows','OpticalGlass'].includes(key)){material.transparent=true;material.opacity=key==='Windows'?.66:.17;material.depthWrite=false;material.side=T.DoubleSide;if(key==='Windows')material.color.setRGB(.065,.085,.095);}
     // Both LODs share the optical/grille detail texture and PBR materials.
     if(key==='RearLens'){material.emissive.setRGB(.12,.001,.002);material.emissiveIntensity=.25;}
     materialMap.set(key,material);
    }
    const mesh=new T.Mesh(geometry,material);mesh.name=n.name+`_LOD${level}`;mesh.userData={...n.userData,lodLevel:level};mesh.castShadow=true;
    mesh.visible=level===0&&!mesh.userData.brakeLight&&!mesh.userData.indicator;parent.add(mesh);triangles[level]+=(geometry.index?.count??geometry.attributes.position.count)/3;
   });
   const rotationClip=(name,duration,nodes,axis,keys)=>new T.AnimationClip(name,duration,nodes.map(([node,sign=1])=>new T.QuaternionKeyframeTrack(`${node.name}.quaternion`,keys.map(k=>k[0]*duration),keys.flatMap(k=>new T.Quaternion().setFromAxisAngle(axis,k[1]*sign).toArray()))));
   const doors=[...pivots.values()].filter(p=>p.userData.vehicleDoor&&p.userData.front).map(p=>[p,p.userData.left?-1:1]);
   const spin=[...pivots.values()].filter(p=>p.userData.vehicleSpin).map(p=>[p]);
   const wheels=[...pivots.values()].filter(p=>p.userData.vehicleWheel&&p.userData.front).map(p=>[p]);
   const wipers=[...pivots.values()].filter(p=>/^Wiper_[LR]$/.test(p.name)).map(p=>{p.userData.wiperAxis=[0,.64,id==='suv'?.522:.412];return [p];});
   const animations=[rotationClip('DoorOpen',.7,doors,new T.Vector3(0,1,0),[[0,0],[1,1.05]]),rotationClip('DoorClose',.7,doors,new T.Vector3(0,1,0),[[0,1.05],[1,0]]),rotationClip('WheelsRoll',1,spin,new T.Vector3(1,0,0),[[0,0],[.25,Math.PI/2],[.5,Math.PI],[.75,Math.PI*1.5],[1,Math.PI*2]]),rotationClip('Steer',2,wheels,new T.Vector3(0,1,0),[[0,0],[.25,.45],[.75,-.45],[1,0]]),rotationClip('Wipers',1.2,wipers,new T.Vector3(0,0,1),[[0,0],[.5,1],[1,0]])];
   animations[4]=rotationClip('Wipers',1.2,wipers,new T.Vector3(0,.64,id==='suv'?.522:.412).normalize(),[[0,0],[.5,1],[1,0]]);
   const bytes=await new GLTFExporter().parseAsync(object,{binary:true,animations,onlyVisible:false});const array=new Uint8Array(bytes);let binary='';for(let j=0;j<array.length;j+=32768)binary+=String.fromCharCode(...array.subarray(j,j+32768));await window.savePacked(id,btoa(binary));report.push({id,triangles,bytes:array.length});
  }return report;
 },`/@fs/${resolve('.').replaceAll('\\','/')}`);console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
