/** Optimize authoring exports once, preserving bone/hinge names and LOD extras. */
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {statSync,writeFileSync} from 'node:fs';
const require=createRequire(resolve('artifacts/blender-work/build-tools/package.json'));
const {NodeIO,PropertyType}=require('@gltf-transform/core');
const {ALL_EXTENSIONS}=require('@gltf-transform/extensions');
const {dedup,prune,resample,textureCompress,meshopt}=require('@gltf-transform/functions');
const {MeshoptEncoder,MeshoptDecoder}=require('meshoptimizer');
const sharp=require('sharp');
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const report=[];
for(const id of (process.argv.slice(2).length?process.argv.slice(2):['yigit','qiz','ishbilarmon','ishchi','sedan','suv'])){
 const input=resolve(`artifacts/blender-work/packed/${id}.glb`),output=resolve(`apps/client/public/models/reference/${id}.glb`);
 const doc=await io.read(input);
 await doc.transform(dedup({propertyTypes:[PropertyType.ACCESSOR,PropertyType.TEXTURE,PropertyType.SKIN]}),prune({keepLeaves:true,keepAttributes:true,keepExtras:true}),resample(),
  textureCompress({encoder:sharp,targetFormat:'webp',resize:[1024,1024],quality:90,effort:50}),meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:16,quantizeNormal:10,quantizeTexcoord:14,quantizeWeight:12}));
 await io.write(output,doc);const entry={id,before:statSync(input).size,bytes:statSync(output).size};report.push(entry);console.log(entry);
}
writeFileSync('artifacts/blender-work/compression-report.json',JSON.stringify(report,null,2));
