import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
  await page.route('https://**',route=>route.abort());
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:90000});
  const result=await page.evaluate(async()=>{
    const {city,engine}=window.__xarita;engine.stop();
    const tick=s=>{for(let i=0;i<s*60;i++) city.update({dt:1/60,elapsed:i/60,frame:i});};
    const p=city.player, input=p.input;
    const key=(code,down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code}));
    tick(1);key('KeyF',true);key('KeyF',false);tick(9);
    const wheels=[];p.car.traverse(n=>{if(n.userData.vehicleWheel)wheels.push(n);});
    const front=wheels.find(n=>n.userData.front), rear=wheels.find(n=>!n.userData.front);
    const spin=front?.children.find(n=>n.userData.vehicleSpin)??front?.getObjectByName('WheelSpin');
    const startSpin=spin?.rotation.x;
    key('KeyW',true);key('KeyA',true);tick(.5);key('KeyA',false);
    const wheelTurn=front?.rotation.y, rearTurn=rear?.rotation.y, wheelSpin=spin?.rotation.x;
    const yaw=p.yaw;
    input.element.dispatchEvent(new MouseEvent('mousedown',{button:2}));
    document.dispatchEvent(new MouseEvent('mousemove',{movementX:650,movementY:40}));tick(.1);
    document.dispatchEvent(new MouseEvent('mouseup',{button:2}));
    const orbitYaw=p.yaw;tick(.5);const heldYaw=p.yaw;
    key('KeyW',false);key('KeyC',true);tick(.5);key('KeyC',false);const resetYaw=p.yaw;
    tick(8);
    const models=city.traffic.characters.length;
    key('KeyF',true);key('KeyF',false);tick(1.5);
    const walker={...p.body.translation()};
    // O'z mashinasi ham yaqin, lekin NPC undan yaqinroq: F eng yaqinni olishi shart.
    p.carPosition.set(walker.x+4,city.ground.heightAt(walker.x+4,walker.z)+.7,walker.z);
    p.carBody.setTranslation(p.carPosition,true);p.carBody.setNextKinematicTranslation(p.carPosition);
    const steal=city.traffic.agents.find(a=>!a.pedestrian);
    const stolenAt={x:walker.x+2,y:city.ground.heightAt(walker.x+2,walker.z)+.72,z:walker.z};
    steal.body.setTranslation(stolenAt,true);steal.body.setNextKinematicTranslation(stolenAt);
    // Tezligi nolga tushiriladi: F o'tirgan mashinaning TEZLIGINI ham meros
    // qilib oladi (bu ataylab shunday), shuning uchun tezligi tasodifiy NPC
    // bilan bu o'lchov "qayerga o'tirdi" emas, "0.1 s da qancha yurdi" ni
    // tekshirib qo'yardi.
    steal.speed=0;
    const carsBefore=city.traffic.counts.cars;
    key('KeyF',true);key('KeyF',false);tick(.1);
    // Claim is immediate; boarding now waits for a collision-tested walk to
    // the door. Population may respawn during that walk, so count here.
    const claimed={identity:p.car.uuid===steal.object.uuid,removed:!city.traffic.agents.includes(steal),mode:p.mode,carsRemoved:carsBefore-city.traffic.counts.cars,distance:Math.hypot(p.carPosition.x-stolenAt.x,p.carPosition.y-stolenAt.y,p.carPosition.z-stolenAt.z)};
    const signalHeads=city.traffic.signals.count;
    const {lanePoint}=await import('/src/city/RoadNetwork.ts');
    const traffic=city.traffic, signals=traffic.signals;
    const agent=traffic.agents.find(a=>!a.pedestrian);
    const edge=traffic.cars.edges.find(e=>signals.stops.get(e.key)?.some(d=>d>25));
    let signalTest=null;
    if(agent&&edge){
      for(const other of [...traffic.agents]) if(other!==agent) traffic.remove(other);
      const stop=signals.stops.get(edge.key).find(d=>d>25);
      const point=lanePoint(edge,stop-12,false);
      const yaw=Math.atan2(edge.b.x-edge.a.x,edge.b.z-edge.a.z);
      agent.edge=edge;agent.nextEdge=null;agent.yaw=yaw;agent.speed=3;agent.stalled=0;
      const start={x:point.x,y:city.ground.heightAt(point.x,point.z)+.75,z:point.z};
      agent.body.setTranslation(start,true);agent.body.setNextKinematicTranslation(start);
      // Put orthogonal phases into red, with enough time remaining to stop.
      const ns=Math.abs(edge.b.z-edge.a.z)>=Math.abs(edge.b.x-edge.a.x);
      signals.time=ns?25:0;
      const far={...p.state,position:{x:99999,z:99999},carPosition:{x:99999,z:99999}};
      const step=()=>city.physics.step(1/60,dt=>traffic.updateCar(agent,dt,far));
      for(let i=0;i<600;i++)step();
      const redPos={...agent.body.translation()};
      const redProgress=(redPos.x-edge.a.x)*Math.sin(yaw)+(redPos.z-edge.a.z)*Math.cos(yaw);
      signals.time=ns?0:25;
      for(let i=0;i<120;i++)step();
      const greenPos=agent.body.translation();
      signalTest={stop,redProgress,greenTravel:Math.hypot(greenPos.x-redPos.x,greenPos.z-redPos.z)};
      traffic.render();
      engine.camera.position.set(point.x+12,start.y+8,point.z+12);
      engine.camera.lookAt(edge.b.x,start.y+1,edge.b.z);
      signals.update(0,point);
    }
    engine.renderer.render(engine.scene,engine.camera);
    const shaderErrors=engine.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length;
    return {mode:p.mode,startSpin,wheelSpin,wheelTurn,rearTurn,yaw,orbitYaw,heldYaw,resetYaw,models,claimed,signalHeads,signalTest,shaderErrors,stats:engine.getStats()};
  });
  console.log(result);
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/navoiy-signals.png'});
  assert.ok(Math.abs(result.wheelSpin-result.startSpin)>.01);
  assert.ok(Math.abs(result.wheelTurn)>.1);assert.equal(result.rearTurn,0);
  assert.ok(Math.abs(result.orbitYaw-result.yaw)>1);assert.equal(result.heldYaw,result.orbitYaw);
  assert.ok(Math.abs(result.resetYaw-result.heldYaw)>.1);
  // O'yinchi personaji + to'rtta Blender personaji.
  assert.equal(result.models,5);assert.ok(result.signalHeads>0);
  assert.equal(result.claimed.identity,true);assert.equal(result.claimed.removed,true);assert.ok(result.claimed.distance<1);
  assert.ok(result.signalTest&&result.signalTest.redProgress<=result.signalTest.stop+.2);
  assert.ok(result.signalTest.greenTravel>1);
  assert.equal(result.shaderErrors,0);assert.deepEqual(errors,[]);
  console.log('PASS: offline models, wheel spin/steer, free orbit, camera reset, real-map signals, red stop/green resume, facade shaders');
} finally{await browser.close();}
