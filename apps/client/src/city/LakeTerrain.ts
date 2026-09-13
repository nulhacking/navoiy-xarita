import type { GroundBounds } from './Ground.ts';
import { insidePolygon } from './RoadNetwork.ts';

/** Local 16x refinement only around Ozero. This is authored bathymetry, not DEM detail.
 * Boundary aligns with coarse terrain cells; physics consumes the same triangles.
 */
export class LakeTerrain {
  readonly divisions=16;
  readonly c0:number;readonly c1:number;readonly r0:number;readonly r1:number;
  readonly nx:number;readonly nz:number;readonly sx:number;readonly sz:number;
  readonly bounds:GroundBounds;
  readonly heights:Float32Array;
  constructor(ring:Float32Array,level:number,bounds:GroundBounds,spacingX:number,spacingZ:number,base:(x:number,z:number)=>number) {
    const xs=[],zs=[];for(let i=0;i<ring.length;i+=2){xs.push(ring[i]!);zs.push(ring[i+1]!);}
    this.c0=Math.max(0,Math.floor((Math.min(...xs)-70-bounds.minX)/spacingX));this.c1=Math.min(256,Math.ceil((Math.max(...xs)+70-bounds.minX)/spacingX));
    this.r0=Math.max(0,Math.floor((Math.min(...zs)-70-bounds.minZ)/spacingZ));this.r1=Math.min(256,Math.ceil((Math.max(...zs)+70-bounds.minZ)/spacingZ));
    this.bounds={minX:bounds.minX+this.c0*spacingX,maxX:bounds.minX+this.c1*spacingX,minZ:bounds.minZ+this.r0*spacingZ,maxZ:bounds.minZ+this.r1*spacingZ};
    this.nx=(this.c1-this.c0)*16+1;this.nz=(this.r1-this.r0)*16+1;this.sx=spacingX/16;this.sz=spacingZ/16;
    this.heights=new Float32Array(this.nx*this.nz);
    for(let row=0;row<this.nz;row++)for(let col=0;col<this.nx;col++) {
      const x=this.bounds.minX+col*this.sx,z=this.bounds.minZ+row*this.sz;
      let d=Infinity;
      for(let i=0;i<ring.length-2;i+=2) {
        const ax=ring[i]!,az=ring[i+1]!,dx=ring[i+2]!-ax,dz=ring[i+3]!-az;
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        d=Math.min(d,Math.hypot(x-ax-dx*t,z-az-dz*t));
      }
      const inside=insidePolygon({x,z},ring),t=Math.min(1,d/28),blend=t*t*(3-2*t);
      this.heights[row*this.nx+col]=inside?level-.25-3.75*Math.min(1,d/12):level+.25+(base(x,z)-level-.25)*blend;
    }
  }
  ownsCell(col:number,row:number):boolean{return col>=this.c0&&col<this.c1&&row>=this.r0&&row<this.r1;}
  contains(x:number,z:number):boolean{return x>=this.bounds.minX&&x<=this.bounds.maxX&&z>=this.bounds.minZ&&z<=this.bounds.maxZ;}
  heightAt(x:number,z:number):number {
    const fx=Math.max(0,Math.min(this.nx-1,(x-this.bounds.minX)/this.sx)),fz=Math.max(0,Math.min(this.nz-1,(z-this.bounds.minZ)/this.sz));
    const col=Math.min(this.nx-2,Math.floor(fx)),row=Math.min(this.nz-2,Math.floor(fz)),tx=fx-col,tz=fz-row;
    const a=this.heights[row*this.nx+col]!,b=this.heights[row*this.nx+col+1]!,c=this.heights[(row+1)*this.nx+col]!,d=this.heights[(row+1)*this.nx+col+1]!;
    return tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
  }
}
