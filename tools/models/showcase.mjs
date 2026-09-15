import {chromium} from 'playwright-core';
import {existsSync} from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}});await page.goto('http://localhost:5173/models.html');await page.waitForFunction(()=>window.__modelStudio);
 await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{createGltfLoader}=await import('/src/city/GltfLoader.ts'),{updateModelLOD}=await import('/src/city/ModelLOD.ts');const {scene,camera,renderer,object}=window.__modelStudio;renderer.setAnimationLoop(null);scene.remove(object);
  const ids=['yigit','qiz','ishbilarmon','ishchi','sedan','suv'];
  for(const [i,id] of ids.entries()){
   const gltf=await createGltfLoader().loadAsync(`/models/reference/${id}.glb`),o=gltf.scene;updateModelLOD(o,0);o.traverse(n=>{if(n.userData.brakeLight||n.userData.indicator)n.visible=false;if(n.isMesh)n.castShadow=true;});
   if(i<4){o.position.set(-2.15+i*.69,0,1.85);o.rotation.y=.3;const mixer=new T.AnimationMixer(o);mixer.clipAction(gltf.animations.find(c=>c.name==='Idle')).play();mixer.update(.5);}
   else if(id==='sedan')o.position.set(1.5,0,-.7);else o.position.set(-1.8,0,-3.7);
   scene.add(o);
  }
  document.querySelector('aside').style.display='none';document.querySelector('#studio').style.gridTemplateColumns='1fr';document.querySelector('.topline').style.display='none';document.querySelector('.bottomline').style.display='none';
  camera.position.set(6.5,2.65,8.5);camera.lookAt(0,.8,-.6);camera.fov=28;camera.aspect=1.6;camera.updateProjectionMatrix();renderer.setSize(1600,1000);renderer.render(scene,camera);
 });
 await page.locator('#viewport canvas').screenshot({path:'artifacts/avatar-turnarounds/3d/current-models.png'});
}finally{await browser.close();}
