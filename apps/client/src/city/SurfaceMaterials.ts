import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

let ground: CanvasTexture | null = null, asphalt: CanvasTexture | null = null, roof: CanvasTexture | null = null;
let parkPaving: CanvasTexture | null = null;
function noise(base: [number,number,number], contrast: number, stripes = false): CanvasTexture {
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d')!;
  const image=ctx.createImageData(128,128);
  let state=91731;
  for(let y=0;y<128;y++) for(let x=0;x<128;x++) {
    state=(1664525*state+1013904223)>>>0;
    const grain=((state>>>24)/255-.5)*contrast + (stripes && y%18<2 ? -.08 : 0);
    const i=(y*128+x)*4;
    image.data[i]=Math.max(0,Math.min(255,base[0]*(1+grain)));
    image.data[i+1]=Math.max(0,Math.min(255,base[1]*(1+grain)));
    image.data[i+2]=Math.max(0,Math.min(255,base[2]*(1+grain)));
    image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0);
  const texture=new CanvasTexture(canvas); texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.colorSpace=SRGBColorSpace; texture.anisotropy=4; return texture;
}
export function groundTexture(): CanvasTexture { return ground ??= noise([215,207,176],.22); }
export function asphaltTexture(): CanvasTexture { return asphalt ??= noise([209,210,207],.07); }
export function roofTexture(): CanvasTexture { return roof ??= noise([220,218,210],.18,true); }

/** Four-metre tile with fine stone grain and restrained 50 cm paving joints. */
export function parkPavingTexture():CanvasTexture {
  if(parkPaving)return parkPaving;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(256,256);let seed=5719;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const joint=y%32===0||(x+(Math.floor(y/32)%2)*16)%32===0;
    const v=(joint?187:238)+((seed>>>24)/255-.5)*13,i=(y*256+x)*4;
    pixels.data[i]=v;pixels.data[i+1]=v;pixels.data[i+2]=v;pixels.data[i+3]=255;
  }
  ctx.putImageData(pixels,0,0);parkPaving=new CanvasTexture(canvas);
  parkPaving.wrapS=parkPaving.wrapT=RepeatWrapping;parkPaving.colorSpace=SRGBColorSpace;parkPaving.anisotropy=8;return parkPaving;
}
