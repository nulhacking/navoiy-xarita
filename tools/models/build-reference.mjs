/** Reproducible Blender -> shared rig/LOD -> optimized runtime asset pipeline. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const blender=process.env.BLENDER_EXE??'D:/Programs/Blender 5.2/blender.exe';
if(!existsSync(blender))throw new Error('Set BLENDER_EXE to your Blender executable. See tools/models/README.md.');
const response=await fetch('http://localhost:5173/models.html').catch(()=>null);
if(!response?.ok)throw new Error('Start npm run dev before the model build.');
const env={...process.env,BLENDER_USER_RESOURCES:resolve('artifacts/blender-work/blender-user'),BLENDER_USER_CONFIG:resolve('artifacts/blender-work/blender-user/config')};
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit',env,windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status})`);}
for(const script of ['blender_humans.py','blender_vehicles.py'])run(blender,['--background','--factory-startup','--python-exit-code','1','--python',`tools/models/${script}`]);
for(const script of ['pack-blender.mjs','pack-blender-cars.mjs','optimize-reference.mjs'])run(process.execPath,[`tools/models/${script}`]);
run(process.execPath,['tools/smoke/reference-models.mjs']);
