import { DataTexture, LinearFilter, MeshPhysicalMaterial, RGBAFormat, Vector2, Vector4 } from 'three';

/** Distance-to-shore lookup is generated from geometry, not a satellite image.
 * One texture sample replaces a 47-edge loop at every water pixel.
 */
export function lakeWater(ring:Vector2[]) {
  const minX=Math.min(...ring.map(p=>p.x)),maxX=Math.max(...ring.map(p=>p.x));
  const minZ=Math.min(...ring.map(p=>p.y)),maxZ=Math.max(...ring.map(p=>p.y));
  const size=192, data=new Uint8Array(size*size*4);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++) {
    const x=minX+(col+.5)/size*(maxX-minX),z=minZ+(row+.5)/size*(maxZ-minZ);
    let distance=Infinity;
    for(let i=0;i<ring.length;i++) {
      const a=ring[i]!,b=ring[(i+1)%ring.length]!,dx=b.x-a.x,dz=b.y-a.y;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.y)*dz)/(dx*dx+dz*dz||1)));
      distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.y-dz*t));
    }
    const k=(row*size+col)*4;data[k]=Math.min(255,Math.round(distance*4));data[k+3]=255;
  }
  const texture=new DataTexture(data,size,size,RGBAFormat);texture.minFilter=texture.magFilter=LinearFilter;texture.needsUpdate=true;
  const time={value:0},bounds={value:new Vector4(minX,minZ,maxX-minX,maxZ-minZ)};
  const material=new MeshPhysicalMaterial({color:0xffffff,roughness:.24,metalness:0,ior:1.333,envMapIntensity:1.1});
  material.name='Ozero · deep teal / wind ripples';
  material.onBeforeCompile=shader=>{
    shader.uniforms.lakeTime=time;shader.uniforms.lakeBounds=bounds;shader.uniforms.shoreDistance={value:texture};
    shader.vertexShader='varying vec3 lakePosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlakePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader='varying vec3 lakePosition; uniform float lakeTime; uniform vec4 lakeBounds; uniform sampler2D shoreDistance;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float shore = texture2D(shoreDistance, (lakePosition.xz-lakeBounds.xy)/lakeBounds.zw).r * 63.75;
      diffuseColor.rgb *= mix(vec3(0.018,0.15,0.105), vec3(0.003,0.036,0.042), smoothstep(1.0,19.0,shore));
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec2 p = lakePosition.xz;
      float warp=sin(p.x*.17+p.y*.08)*1.3+sin(p.y*.23)*.7;
      float a=dot(p,vec2(0.83,0.37))*2.8-lakeTime*1.7+warp;
      float b=dot(p,vec2(-0.27,0.94))*5.1-lakeTime*2.1+warp*.5;
      float c=dot(p,vec2(0.61,0.79))*.72-lakeTime*.65;
      vec2 slope=vec2(.83,.37)*cos(a)*.035+vec2(-.27,.94)*cos(b)*.018+vec2(.61,.79)*cos(c)*.028;
      normal = normalize(mat3(viewMatrix) * normalize(vec3(-slope.x,1.0,-slope.y)));
    `);
  };
  material.customProgramCacheKey=()=> 'navoiy-lake-v1';
  return {material,update:(dt:number)=>{time.value=(time.value+Math.min(dt,.1))%3600;},dispose:()=>{texture.dispose();material.dispose();}};
}
