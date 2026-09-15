import { Group, Mesh, Texture, Vector4, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';

/** Upload both LODs and compile shadow variants behind the loading screen.
 * compileAsync alone does not upload off-screen geometry or compile depth passes.
 */
export async function warmScene(renderer:WebGLRenderer,scene:Scene,camera:PerspectiveCamera,templates:Object3D[]=[]):Promise<void> {
  const staging=new Group();staging.name='Asset warmup';
  const parents=templates.map(object=>object.parent);
  staging.add(...templates);scene.add(staging);
  const state:Array<{object:Object3D;visible:boolean;culled:boolean}>=[];
  const textures=new Set<Texture>();
  const previousTarget=renderer.getRenderTarget();
  const viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
  try {
    scene.traverse(object=>{
      state.push({object,visible:object.visible,culled:object.frustumCulled});
      // Keep light counts and shader keys identical to gameplay.
      if(object instanceof Mesh||object instanceof Group){object.visible=true;object.frustumCulled=false;}
      if(object instanceof Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]) {
        for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
      }
    });
    for(const texture of textures)renderer.initTexture(texture);
    await renderer.compileAsync(scene,camera);
    // Use the display framebuffer: an offscreen target compiles linear-output
    // variants, leaving the sRGB display variants cold on the first camera turn.
    renderer.setRenderTarget(null);renderer.setViewport(0,0,32,32);renderer.setScissor(0,0,32,32);renderer.setScissorTest(true);
    renderer.render(scene,camera);
    // Give the browser a frame to finish submitting uploads before gameplay.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  } finally {
    renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    for(const {object,visible,culled} of state){object.visible=visible;object.frustumCulled=culled;}
    scene.remove(staging);
    templates.forEach((object,i)=>{staging.remove(object);parents[i]?.add(object);});
  }
}
