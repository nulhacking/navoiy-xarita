import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio?.object);
for(const [label,url] of [['raw','/@fs/D:/startup/xarita/artifacts/blender-work/yigit-raw.glb'],['packed','/@fs/D:/startup/xarita/artifacts/blender-work/packed/yigit.glb'],['compressed','/models/reference/yigit.glb']]){
 console.log(label,await page.evaluate(async url=>{const s=window.__modelStudio;const {createGltfLoader}=await import('/src/city/GltfLoader.ts');const {updateModelLOD}=await import('/src/city/ModelLOD.ts');s.renderer.setAnimationLoop(null);s.scene.remove(s.object);const g=await createGltfLoader().loadAsync(url);s.scene.add(g.scene);s.object=g.scene;updateModelLOD(g.scene);s.camera.position.set(.7,1.6,2);s.camera.lookAt(0,1.4,0);s.renderer.render(s.scene,s.camera);const meshes=[];g.scene.traverse(n=>{if(n.isMesh)meshes.push({name:n.name,scale:n.scale.toArray(),det:n.matrixWorld.determinant(),mat:n.material.name,alpha:n.material.opacity,side:n.material.side});});return meshes;},url));await page.screenshot({path:`artifacts/blender-work/inspect-${label}.png`});}
}finally{await browser.close();}
