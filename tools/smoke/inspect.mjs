import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,600));});
  page.on('requestfailed',r=>console.log('REQUEST',r.url(),r.failure()?.errorText));
  await page.goto('http://localhost:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__xarita?.city.isReady||document.querySelector('.setup'),null,{timeout:45000}).catch(()=>{});
  console.log(await page.locator('body').innerText());
  console.log(await page.evaluate(()=>({ready:window.__xarita?.city.isReady,ground:!!window.__xarita?.city.ground,player:!!window.__xarita?.city.player})));
  mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/inspect.png'});
} finally {await browser.close();}
