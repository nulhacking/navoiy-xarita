import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',route=>route.abort());
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady,null,{timeout:45000});
  await page.evaluate(()=>window.__xarita.engine.stop());
  await page.keyboard.press('KeyM');
  await page.waitForFunction(()=>document.querySelector('.bigmap')&&!document.querySelector('.bigmap-status'),null,{timeout:30000});
  await page.getByRole('button',{name:'Mening joyim'}).click();
  await page.getByRole('button',{name:'Yaqinlashtirish'}).click();
  assert.ok((await page.locator('.map-tools').innerText()).includes('12.0'));
  await page.locator('.bigmap-canvas canvas').click({position:{x:200,y:230}});
  const button=page.getByRole('button',{name:"O'sha yerda paydo bo'lish"});
  await button.click({trial:true});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/navoiy-map-zoom.png'});
  assert.deepEqual(errors,[]);console.log('PASS: offline startup, vector map zoom, waypoint and reachable teleport button');
} finally {await browser.close();}
