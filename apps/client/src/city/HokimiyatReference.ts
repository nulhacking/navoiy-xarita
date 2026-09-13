import { Vector3 } from 'three';
import type { CityFrame } from './CityFrame.ts';

/** Exact baked OSM identities, not a proximity replacement of unrelated buildings. */
export const HOKIMIYAT_IDS=new Set([146696850,146696818,367714606]);
export const HOKIMIYAT_ORIGIN={lon:65.3738598526,lat:40.1033156595,alt:0};
export const HOKIMIYAT_HEIGHT=45.8; // Existing OSM 14-level extrusion, not a surveyed height.
export const HOKIMIYAT_RINGS=[
  [[65.37372708320618,40.10319051439791],[65.37369757890701,40.10325103606561],[65.37368014454842,40.10328693872439],[65.37365198135376,40.10334540872815],[65.37399262189865,40.10344080704745],[65.37406772375107,40.10328693872439]],
  [[65.37339180707932,40.10189492748048],[65.37274271249771,40.10319461756352],[65.37302166223526,40.10327565503368],[65.3731021285057,40.10311357999684],[65.37312090396881,40.10307767724656],[65.37366941571236,40.10197596649873]],
  [[65.3731021285057,40.10311357999684],[65.37312090396881,40.10307767724656],[65.37369757890701,40.10325103606561],[65.37368014454842,40.10328693872439]],
] as const;

export function hokimiyatBasis(frame:CityFrame){
  const origin=frame.toLocal(HOKIMIYAT_ORIGIN);
  const a=frame.toLocal({lon:HOKIMIYAT_RINGS[0][3][0],lat:HOKIMIYAT_RINGS[0][3][1],alt:0});
  const b=frame.toLocal({lon:HOKIMIYAT_RINGS[0][4][0],lat:HOKIMIYAT_RINGS[0][4][1],alt:0});
  const east=b.sub(a).setY(0).normalize(),south=new Vector3(-east.z,0,east.x);
  return {origin,east,south,
    point:(u:number,v:number)=>origin.clone().addScaledVector(east,u).addScaledVector(south,v),
    uv:(p:{x:number;z:number})=>({u:(p.x-origin.x)*east.x+(p.z-origin.z)*east.z,v:(p.x-origin.x)*south.x+(p.z-origin.z)*south.z})};
}

/** Authored site stays between the mapped roads; the roads themselves retain OSM geometry. */
export function hokimiyatTreeExclusion(frame:CityFrame){
  const basis=hokimiyatBasis(frame);
  return (p:{x:number;z:number})=>{const {u,v}=basis.uv(p);return u>-101&&u<49&&v>-40&&v<167;};
}

/** Screenshot readout, Apple z18, center cross at (640,360). Heights not recoverable here. */
export function hokimiyatSatelliteGeo(x:number,y:number){
  const size=256*2**18,cy=(1-Math.asinh(Math.tan(40.10265*Math.PI/180))/Math.PI)/2;
  return {lon:65.3737+(x-640)/size*360,lat:Math.atan(Math.sinh(Math.PI*(1-2*(cy+(y-360)/size))))*180/Math.PI,alt:0};
}
