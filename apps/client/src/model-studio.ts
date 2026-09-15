import { ACESFilmicToneMapping, AnimationMixer, Box3, Color, DirectionalLight, GridHelper, HemisphereLight, LoopOnce, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer, type AnimationAction, type Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGltfLoader } from './city/GltfLoader.ts';
import { updateModelLOD } from './city/ModelLOD.ts';
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './model-studio.css';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = el('viewport'), select = el<HTMLSelectElement>('model'), animation = el<HTMLSelectElement>('animation');
const scene = new Scene(); scene.background = new Color('#e8e5dd');
scene.add(new HemisphereLight(0xffffff, 0x77776c, .65));
const sun = new DirectionalLight(0xfff8ed, 2.4); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -5; sun.shadow.camera.right = 5; sun.shadow.camera.top = 5; sun.shadow.camera.bottom = -5; sun.shadow.normalBias = .015; scene.add(sun);
const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: '#dedcd5', roughness: 1 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -.005; floor.receiveShadow = true; scene.add(floor);
const grid = new GridHelper(20, 40, 0xc8c6bd, 0xd6d4cb); grid.position.y = -.002; grid.visible=false; scene.add(grid);
const camera = new PerspectiveCamera(38, 1, .02, 200);
const renderer = new WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6)); renderer.shadowMap.enabled = true; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 1; viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.minDistance = 1.1; controls.maxDistance = 15;
const pmrem = new PMREMGenerator(renderer), room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .06).texture; scene.environmentIntensity = .75;
room.dispose(); pmrem.dispose();
let object: Object3D | null = null, mixer: AnimationMixer | null = null, action: AnimationAction | null = null, clips: Awaited<ReturnType<ReturnType<typeof createGltfLoader>['loadAsync']>>['animations'] = [], paused = false, generation = 0, car = false;
const names: Record<string,string> = { Idle:'Tinch turish',Walk:'Yurish',Run:'Yugurish',Jump:'Sakrash',Fall:'Havoda tushish',Land:'Yerga qo‘nish',Sitting:'O‘tirish',Drive:'Haydash holati',EnterVehicle:'Transportga chiqish',ExitVehicle:'Transportdan tushish',Swim:'Suzish',TreadWater:'Suvda turish',Wave:'Salomlashish',Interact:'Qo‘l uzatish',Hit:'Zarbga reaksiya',DoorOpen:'Eshikni ochish',DoorClose:'Eshikni yopish',WheelsRoll:'G‘ildirak aylanishi',Steer:'Burilish',Wipers:'Oyna tozalagich' };
const labels: Record<string,string> = {yigit:'Yigit',qiz:'Qiz',ishbilarmon:'Ishbilarmon',ishchi:'Ishchi',sedan:'Sedan',suv:'SUV'};
function view(kind = 'angle'): void {
  const target = new Vector3(0, car ? .72 : .9, 0), distance = car ? 7.5 : 3.9;
  const positions: Record<string,Vector3> = {front:new Vector3(0,target.y,distance),side:new Vector3(distance,target.y,0),back:new Vector3(0,target.y,-distance),angle:new Vector3(distance*.55,target.y+distance*.19,distance*.85)};
  camera.position.copy(positions[kind]); controls.target.copy(target); controls.update();
}
function play(): void {
  if (!mixer) return;
  mixer.stopAllAction();
  // Restore the exported rest transform before switching between accessory clips.
  object?.traverse(n => { const rest = n.userData.studioRest as number[] | undefined; if (rest) n.quaternion.fromArray(rest); });
  const clip = clips.find(c => c.name === animation.value);
  if (!clip) return;
  action = mixer.clipAction(clip).reset().play();
  if (['DoorOpen','DoorClose','Jump','Land','EnterVehicle','ExitVehicle','Wave','Hit','Interact'].includes(clip.name)) { action.setLoop(LoopOnce,1); action.clampWhenFinished = true; }
  mixer.timeScale = Number(el<HTMLSelectElement>('speed').value);
  paused = false; el('play').textContent = 'To‘xtatish';
}
async function load(): Promise<void> {
  const version = ++generation, id = select.value; el('status').textContent = 'Yuklanmoqda…';
  try {
    const gltf = await createGltfLoader().loadAsync(`/models/reference/${id}.glb`);
    if (version !== generation) return;
    if (object) { mixer?.stopAllAction(); mixer?.uncacheRoot(object); scene.remove(object); object.traverse(n => { if (n instanceof Mesh) { n.geometry.dispose(); for (const m of Array.isArray(n.material)?n.material:[n.material]) { if ('map' in m) (m as MeshStandardMaterial).map?.dispose(); m.dispose(); } } }); }
    object = gltf.scene; car = ['sedan','suv'].includes(id); let triangles = 0;
    updateModelLOD(object,el<HTMLInputElement>('distant').checked?10000:0);
    object.traverse(n => { n.userData.studioRest = n.quaternion.toArray(); if (n.userData.brakeLight || n.userData.indicator) n.visible = false; if (n instanceof Mesh) { n.castShadow = true; triangles += (n.geometry.index?.count ?? n.geometry.getAttribute('position').count)/3; for(const material of Array.isArray(n.material)?n.material:[n.material]) (material as MeshStandardMaterial).wireframe = el<HTMLInputElement>('wire').checked; } });
    const box = new Box3().setFromObject(object); object.position.y -= box.min.y; scene.add(object);
    clips = gltf.animations; mixer = new AnimationMixer(object);
    animation.replaceChildren(...clips.map(c => new Option(names[c.name] ?? c.name,c.name)));
    animation.value = car ? 'WheelsRoll' : 'Idle'; play(); view();
    el('model-title').textContent = labels[id]; el('status').textContent = `${clips.length} animatsiya · tayyor`;
    let visibleTriangles=0;object.traverseVisible(n=>{if(n instanceof Mesh)visibleTriangles+=(n.geometry.index?.count??n.geometry.getAttribute('position').count)/3;});
    el('stats').textContent = `${Math.round(visibleTriangles).toLocaleString()} uchburchak · LOD tayyor`;
    el<HTMLAnchorElement>('download').href = `/models/reference/${id}.glb`;
    el<HTMLAnchorElement>('game').href = car ? '/' : `/?avatar=${id}`;
    Object.assign(window,{__modelStudio:{object,mixer,clips,renderer,scene,camera,select,animation,play}});
  } catch(error) { if(version===generation)el('status').textContent = `Xato: ${error instanceof Error?error.message:String(error)}`; }
}
select.addEventListener('change',()=>void load()); animation.addEventListener('change',play);
el('play').addEventListener('click',()=>{if(action?.paused&&!paused){play();return;}paused=!paused;el('play').textContent=paused?'Davom ettirish':'To‘xtatish';});
el('speed').addEventListener('change',()=>{if(mixer)mixer.timeScale=Number(el<HTMLSelectElement>('speed').value);});
el('timeline').addEventListener('input',()=>{if(!action||!mixer)return;paused=true;action.paused=false;action.time=Number(el<HTMLInputElement>('timeline').value)*action.getClip().duration;mixer.update(0);el('play').textContent='Davom ettirish';});
el('distant').addEventListener('change',()=>{if(!object)return;updateModelLOD(object,el<HTMLInputElement>('distant').checked?10000:0);let triangles=0;object.traverseVisible(n=>{if(n instanceof Mesh)triangles+=(n.geometry.index?.count??n.geometry.getAttribute('position').count)/3;});el('stats').textContent=`${triangles.toLocaleString()} uchburchak`;});
el('wire').addEventListener('change',()=>object?.traverse(n=>{if(n instanceof Mesh)for(const m of Array.isArray(n.material)?n.material:[n.material])(m as MeshStandardMaterial).wireframe=el<HTMLInputElement>('wire').checked;}));
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))button.addEventListener('click',()=>view(button.dataset.view));
new ResizeObserver(()=>{const {width,height}=viewport.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();}).observe(viewport);
let last=performance.now();renderer.setAnimationLoop(now=>{const dt=Math.min((now-last)/1000,.05);last=now;if(!paused)mixer?.update(dt);if(action){el<HTMLInputElement>('timeline').value=String(action.time/action.getClip().duration);el('frame-time').textContent=`${action.time.toFixed(2)} s`;}controls.update();renderer.render(scene,camera);});
void load();
