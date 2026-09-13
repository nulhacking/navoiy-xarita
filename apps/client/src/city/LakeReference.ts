import type { CityFrame } from './CityFrame.ts';

/** Three shoreline control points in the user's first satellite screenshot.
 * Park details are visual estimates, NOT surveyed coordinates or facade data.
 * Lake geometry itself always comes from the original OSM water ring.
 */
export function referenceGeo(x: number, y: number): { lon: number; lat: number; alt: number } {
  const dx=x-315, dy=y-488, det=240*345+93*262;
  const u=(dx*345-dy*262)/det, v=(240*dy+93*dx)/det;
  return {lon:65.363102+u*.003901+v*.004156,lat:40.109020+u*.001177-v*.004322,alt:0};
}

export function referencePoint(frame: CityFrame, x: number, y: number) {
  return frame.toLocal(referenceGeo(x,y));
}

export type ReferenceXY = readonly [number, number];
export interface ParkBed {
  id: string;
  ring: readonly ReferenceXY[];
  spacing: number;
  pattern: 'rows' | 'grove';
  scale: number;
  pine: number;
  color: number;
}

/** User overview pixel frame; checked against satellites.pro Apple imagery at z17–19.
 * These are manually interpreted planting BLOCKS, not individual surveyed trees.
 * The row bearing follows the park's long edge instead of the screenshot's pixel axes.
 */
export const PARK_BEDS: readonly ParkBed[] = [
  {id:'monument-west',ring:[[366,77],[435,54],[467,143],[420,237]],spacing:8,pattern:'rows',scale:.78,pine:.18,color:0x737456},
  {id:'monument-east',ring:[[439,52],[522,24],[576,184],[481,213],[460,151]],spacing:7.5,pattern:'grove',scale:1.05,pine:.65,color:0x516344},
  {id:'flag-north',ring:[[430,253],[572,205],[595,266],[455,316]],spacing:6.8,pattern:'rows',scale:.48,pine:.12,color:0x868063},
  {id:'flag-south',ring:[[453,324],[596,277],[630,382],[476,437]],spacing:7,pattern:'rows',scale:.53,pine:.18,color:0x787757},
  {id:'east-formal',ring:[[586,248],[610,238],[696,471],[665,478]],spacing:7.5,pattern:'rows',scale:.62,pine:.48,color:0x68704e},
  {id:'amphitheatre-grove',ring:[[635,568],[669,550],[759,624],[715,660]],spacing:8,pattern:'grove',scale:.95,pine:.2,color:0x596c46},
  {id:'east-lake-grove',ring:[[698,665],[746,639],[785,703],[744,746]],spacing:8,pattern:'grove',scale:.86,pine:.2,color:0x637349},
  {id:'southwest-woods',ring:[[409,904],[468,887],[517,1016],[449,1043]],spacing:7,pattern:'grove',scale:1.15,pine:.12,color:0x506442},
  {id:'south-gardens',ring:[[453,1049],[517,1026],[570,966],[626,1006],[642,1028],[458,1090]],spacing:8,pattern:'grove',scale:1.0,pine:.14,color:0x5b6e44},
  {id:'rides-gardens',ring:[[480,863],[586,855],[641,929],[565,990],[518,927]],spacing:9,pattern:'grove',scale:.77,pine:.22,color:0x6c7550},
  {id:'sports-border',ring:[[641,942],[709,912],[760,970],[654,1010]],spacing:7.5,pattern:'rows',scale:.85,pine:.25,color:0x5e7048},
];
export const PLANTING_ZONES = PARK_BEDS.map(b=>b.ring);

/** Deterministic, rotated planting pattern, with irregular gaps in mature groves. */
export function plantingCandidates(bed: ParkBed): Array<{x:number;y:number;scale:number;shape:number}> {
  const theta=-.35,c=Math.cos(theta),s=Math.sin(theta);
  const rotated=bed.ring.map(([x,y])=>[x*c+y*s,-x*s+y*c] as const);
  const us=rotated.map(p=>p[0]),vs=rotated.map(p=>p[1]);
  const out:Array<{x:number;y:number;scale:number;shape:number}>=[];
  const random=(u:number,v:number,k:number)=>{const n=Math.sin(u*12.9898+v*78.233+k*39.425)*43758.5453;return n-Math.floor(n);};
  for(let v=Math.min(...vs);v<Math.max(...vs);v+=bed.spacing)for(let u=Math.min(...us);u<Math.max(...us);u+=bed.spacing) {
    const r=random(u,v,0),jitter=bed.pattern==='grove'?.7:.09;
    if(bed.pattern==='grove'&&r<.15)continue;
    const a=u+(random(u,v,1)-.5)*bed.spacing*jitter,b=v+(random(u,v,2)-.5)*bed.spacing*jitter;
    const x=a*c-b*s,y=a*s+b*c;if(!inPolygon(x,y,bed.ring))continue;
    out.push({x,y,scale:bed.scale*(.76+random(u,v,3)*.48),shape:r<bed.pine?1:r>.82?2:0});
  }
  return out;
}

export function inPolygon(x:number,y:number,poly:ReadonlyArray<readonly [number,number]>):boolean {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i]!,b=poly[j]!;
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

export function referenceTreeExclusion(frame:CityFrame):(p:{x:number;z:number})=>boolean {
  const zones=PLANTING_ZONES.map(zone=>zone.map(([x,y])=>{
    const p=referencePoint(frame,x,y);return [p.x,p.z] as const;
  }));
  return p=>zones.some(zone=>inPolygon(p.x,p.z,zone));
}

export function isNavoiLake(ring: readonly number[]): boolean {
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(let i=0;i<ring.length;i+=2){west=Math.min(west,ring[i]!);east=Math.max(east,ring[i]!);south=Math.min(south,ring[i+1]!);north=Math.max(north,ring[i+1]!);}
  return Math.abs(west-65.363102)<.0002&&Math.abs(east-65.369552)<.0002&&
    Math.abs(south-40.104698)<.0002&&Math.abs(north-40.110197)<.0002;
}
