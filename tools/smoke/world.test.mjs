import test from 'node:test';
import assert from 'node:assert/strict';
import { MapView } from '../../apps/client/src/city/MapView.ts';
import { WaterZones, waterSurfaceLevel } from '../../apps/client/src/city/WaterZones.ts';
import { buildingStyle } from '../../apps/client/src/city/BuildingStyle.ts';
import { approach, yawRate } from '../../apps/client/src/city/VehicleMotion.ts';
import { RoadNetwork } from '../../apps/client/src/city/RoadNetwork.ts';
import { signalPhase, signalStops } from '../../apps/client/src/city/SignalRules.ts';
import { rigVehicle, animateVehicle } from '../../apps/client/src/city/VehicleRig.ts';
import { ownsQuantizedPolygon, ownsQuantizedSegment } from '../../apps/client/src/city/TileOwnership.ts';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { LakeTerrain } from '../../apps/client/src/city/LakeTerrain.ts';
import { referenceGeo, isNavoiLake, PARK_BEDS, plantingCandidates, inPolygon } from '../../apps/client/src/city/LakeReference.ts';
import { HOKIMIYAT_IDS, HOKIMIYAT_RINGS, hokimiyatSatelliteGeo } from '../../apps/client/src/city/HokimiyatReference.ts';

test('hokimiyat reference only replaces its three source buildings and georeferences the screen center',()=>{
  assert.equal(HOKIMIYAT_IDS.has(146696850),true);
  assert.equal(HOKIMIYAT_IDS.has(175014080),false,'city hall is a different building');
  const center=hokimiyatSatelliteGeo(640,360);
  assert.ok(Math.abs(center.lat-40.10265)<1e-10);assert.equal(center.lon,65.3737);
  assert.ok(hokimiyatSatelliteGeo(640,280).lat>center.lat);
  assert.ok(hokimiyatSatelliteGeo(772,360).lon>center.lon);
  for(const ring of HOKIMIYAT_RINGS)for(const [lon,lat]of ring){assert.ok(lon>65.372&&lon<65.375);assert.ok(lat>40.101&&lat<40.104);}
});

test('reference planting stays in its mapped bed and separates saplings from mature groves',()=>{
  const means={rows:[],grove:[]};
  for(const bed of PARK_BEDS){
    const points=plantingCandidates(bed);
    assert.deepEqual(plantingCandidates(bed),points,'tile reload must not shuffle trees');
    assert.ok(points.length>5);
    for(const p of points){assert.ok(inPolygon(p.x,p.y,bed.ring));assert.ok(p.scale>0&&Number.isFinite(p.scale));}
    means[bed.pattern].push(points.reduce((sum,p)=>sum+p.scale,0)/points.length);
  }
  const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
  assert.ok(mean(means.grove)>mean(means.rows),'mature groves should not look like young formal planting');
});

test('satellite reference control points retain their OSM geographic anchors',()=>{
  assert.deepEqual(referenceGeo(315,488),{lon:65.363102,lat:40.109020,alt:0});
  assert.ok(Math.abs(referenceGeo(555,395).lon-65.367003)<1e-10);
  assert.ok(Math.abs(referenceGeo(577,833).lat-40.104698)<1e-10);
  assert.equal(isNavoiLake([65.363102,40.104698,65.369552,40.110197]),true);
  assert.equal(isNavoiLake([65.37,40.104,65.39,40.11]),false);
});

test('refined lake bed stays submerged and rejoins coarse terrain without a height step',()=>{
  const bounds={minX:0,minZ:0,maxX:20000,maxZ:20000},base=(x,z)=>102+x*.001+z*.002;
  const detail=new LakeTerrain(new Float32Array([200,200,500,200,500,700,200,700,200,200]),100,bounds,20000/256,20000/256,base);
  assert.ok(Math.abs(detail.heightAt(350,450)-96)<1e-4);
  assert.ok(detail.heightAt(205,450)<100);
  const b=detail.bounds;
  for(const [x,z] of [[b.minX,b.minZ],[b.maxX,b.maxZ],[b.minX,(b.minZ+b.maxZ)/2]])assert.ok(Math.abs(detail.heightAt(x,z)-base(x,z))<1e-4);
  assert.equal(detail.ownsCell(detail.c0,detail.r0),true);
  assert.equal(detail.ownsCell(detail.c1,detail.r1),false);
});

test('signal approaches use mapped coordinates; perpendicular greens never overlap', () => {
  const network = new RoadNetwork([{roads:[{cls:'primary',width:12,pts:new Float32Array([0,-100,0,0,0,100])},
    {cls:'primary',width:12,pts:new Float32Array([-100,0,0,0,100,0])}]}]);
  const stops=signalStops(network.edges,[{x:0,z:0}]);
  assert.equal(stops.size,4);
  assert.ok([...stops.values()].every(v=>v.length===1&&v[0]===86));
  const north=network.edges.find(e=>e.from==='0,-100');
  const east=network.edges.find(e=>e.from==='-100,0');
  for(let t=0;t<100;t+=.1) assert.ok(!(signalPhase(t,north)==='green'&&signalPhase(t,east)==='green'));
  assert.equal(signalPhase(21,north),'amber');
  assert.equal(signalPhase(24,north),'red'); assert.equal(signalPhase(24,east),'red');
});

test('four wheel pivots survive rigging, steer independently, roll forward/reverse and stay still when stopped', () => {
  const source=new Group();
  const material=new MeshBasicMaterial();
  for(const [end,z] of [['Front',1.4],['Rear',-1.4]]) for(const [side,x] of [['L',1],['R',-1]]) {
    const wheel=new Group();wheel.name=`Wheel${end}${side}`;wheel.position.set(x,.4,z);
    wheel.rotation.y=end==='Front' ? -.5 : 0;
    wheel.add(new Mesh(new BoxGeometry(.2,.8,.8),material));source.add(wheel);
  }
  const rig=rigVehicle(source,g=>g);
  const front=rig.getObjectByName('WheelFrontL'),rear=rig.getObjectByName('WheelRearL');
  assert.ok(front.position.z>rear.position.z);
  rig.scale.setScalar(.5);
  animateVehicle(rig,.2,.3);
  assert.equal(front.rotation.y,.3);assert.equal(rear.rotation.y,0);
  const spin=front.getObjectByName('WheelSpin');
  assert.ok(Math.abs(spin.rotation.x-1)<1e-6);
  animateVehicle(rig,0,-.2);assert.ok(Math.abs(spin.rotation.x-1)<1e-6);
  animateVehicle(rig,-.2,0);assert.ok(Math.abs(spin.rotation.x)<1e-6);
  const clone=rig.clone(true);animateVehicle(clone,.2,.4);
  assert.equal(front.rotation.y,0);assert.equal(clone.getObjectByName('WheelFrontL').rotation.y,.4);
  assert.ok(front.getWorldPosition(new Vector3()).distanceTo(rear.getWorldPosition(new Vector3()))>1);
});

test('zoom anchors the cursor; screen/map round-trip remains exact after pan', () => {
  const v = new MapView(), point = v.toMap(.65,.4);
  v.zoomAt(8,.65,.4);
  assert.ok(Math.abs(v.toMap(.65,.4).x-point.x)<1e-10);
  v.pan(.1,-.2);
  const screen = v.toScreen(.42,.71), back = v.toMap(screen.x,screen.y);
  assert.ok(Math.abs(back.x-.42)<1e-10 && Math.abs(back.y-.71)<1e-10);
  v.zoomAt(1000); assert.equal(v.zoom,32);
  v.reset(); assert.equal(v.zoom,1); assert.equal(v.centerX,.5);
});
test('shoreline margin and swept movement stop a car before a narrow canal', () => {
  const water = new WaterZones(); water.set([new Float32Array([0,-5,1,-5,1,5,0,5])]);
  assert.equal(water.contains({x:.5,z:0}),true);
  assert.equal(water.contains({x:-1,z:0},2.5),true);
  assert.equal(water.contains({x:-4,z:0},2.5),false);
  const f=water.movementFraction({x:-10,z:0},{x:10,z:0},2.5);
  assert.ok(f>0&&f<.4);
  assert.equal(water.movementFraction({x:-10,z:10},{x:10,z:10},2.5),1);
});
test('water level is the lower quarter of the bank, not its lowest point', () => {
  // Bitta xato past nuqta butun havzani yerga ko'mib yubormasligi kerak.
  assert.equal(waterSurfaceLevel([10, 11, 12, 13, 20]), 11);
  // Kamida besh nuqtada bitta chetdagi past qiymat tashlab yuboriladi;
  // to'rtburchak ariqda esa u eng pastiga teng bo'ladi — halqa kichik,
  // yer esa uning ostida baribir tekis.
  assert.equal(waterSurfaceLevel([5, 100, 100, 100, 100]), 100);
  assert.equal(waterSurfaceLevel([5, 100, 100, 100]), 5);
  assert.equal(waterSurfaceLevel([]), Infinity);
});
test('a water body reports its level inside and nothing on dry land', () => {
  const water = new WaterZones();
  const pond = new Float32Array([0, 0, 20, 0, 20, 20, 0, 20]);
  const canal = new Float32Array([5, 5, 15, 5, 15, 8, 5, 8]);
  water.set([pond, canal], (ring) => (ring === pond ? 100 : 103));
  assert.equal(water.levelAt({ x: 2, z: 2 }), 100);
  // Ustma-ust tushganda balandrog'i: kanal ko'l yuzasidan pastda kesilmasin.
  assert.equal(water.levelAt({ x: 10, z: 6 }), 103);
  assert.equal(water.levelAt({ x: -5, z: 10 }), null);
  // Sath berilmasa suv baribir to'siq bo'lib qoladi.
  const plain = new WaterZones();
  plain.set([pond]);
  assert.equal(plain.levelAt({ x: 2, z: 2 }), null);
  assert.equal(plain.contains({ x: 2, z: 2 }), true);
});
test('OSM type, explicit colour and floors drive building appearance', () => {
  assert.notEqual(buildingStyle({kind:'house'}).wall,buildingStyle({kind:'industrial'}).wall);
  assert.equal(buildingStyle({kind:'industrial'}).windows,false);
  assert.equal(buildingStyle({colour:'#ffeecc',levels:5}).wall,'#ffeecc');
  assert.equal(buildingStyle({levels:5}).levels,5);
  assert.equal(new Set(['house','apartments','retail','school'].map(kind=>buildingStyle({kind}).facade)).size,4);
  assert.equal(buildingStyle({colour:'url(secret)'}).wall,buildingStyle({}).wall);
});
test('tyre grip limits yaw at speed; stopped cars cannot pivot; braking cannot overshoot', () => {
  assert.equal(yawRate(0,.5),0);
  assert.ok(Math.abs(yawRate(30,.5))<=6/30);
  assert.ok(yawRate(-5,.4)<0);
  assert.equal(approach(.1,0,9,1/60),0);
  const results=[30,60,120].map(hz=>{let v=0;for(let i=0;i<hz*2;i++)v=approach(v,20,5,1/hz);return v;});
  assert.ok(Math.max(...results)-Math.min(...results)<1e-9);
});
test('OSM oneway and duplicate tile roads form one directed edge', () => {
  const map={roads:[{cls:'residential',width:8,oneway:1,pts:new Float32Array([0,0,0,100])}],buildings:[],water:[],areas:[]};
  const network = new RoadNetwork([map,map]);
  assert.equal(network.edges.length,1);assert.equal(network.edges[0].to,'0,100');
});

test('overlapping OSM tile copies have one visual owner', () => {
  const west={x:10,y:20,extent:100};
  const east={x:11,y:20,extent:100};
  // Bir xil bino nusxasi: west taylda +45, east taylda -55.
  assert.equal(ownsQuantizedPolygon(west,[40,40,50,40,50,50,40,50]),true);
  assert.equal(ownsQuantizedPolygon(east,[-60,40,-50,40,-50,50,-60,50]),false);
  // Yo'l bo'lagi ham o'z markaziga qarab faqat bir marta chiziladi.
  assert.equal(ownsQuantizedSegment(west,20,30,80,30),true);
  assert.equal(ownsQuantizedSegment(east,-80,30,-20,30),false);
});
