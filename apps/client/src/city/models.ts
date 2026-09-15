import { AnimationClip, Box3, BufferAttribute, Group, Mesh, MeshPhysicalMaterial, SkinnedMesh, Sphere, Vector3, type Object3D, type BufferGeometry, type Material } from 'three';
import { rigVehicle } from './VehicleRig.ts';
import { createGltfLoader } from './GltfLoader.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { updateModelLOD } from './ModelLOD.ts';

/**
 * Tayyor 3D modellar.
 *
 * CarConcept — CC BY 4.0; Quaternius personajlari — CC0.
 * Yuklash skriptlari tools/models ichida, manba/litsenziyalar public/models ichida.
 */

export interface LoadedModel {
  /** Sahnaga qo'shiladigan guruh. Oyoq/g'ildirak `y = 0` da turadi. */
  object: Group;
  animations: AnimationClip[];
}

const loader = createGltfLoader();

/**
 * Modelni yuklaydi va berilgan o'lchamga moslaydi.
 *
 * O'lcham chegaraviy quti orqali fizik metrga moslanadi. Avtomobilning
 * old tomoni esa VehicleRig ichida nomlangan old/orqa o'qlardan aniqlanadi;
 * boshqa avtomobil asseti qo'shilganda uning o'qlari ham tekshirilishi kerak.
 *
 * @param targetSize kerakli o'lcham, metr
 * @param fitAxis    qaysi o'lcham bo'yicha moslash: 'height' yoki 'length'
 */
async function loadFitted(
  url: string,
  targetSize: number,
  fitAxis: 'height' | 'length',
): Promise<LoadedModel> {
  const gltf = await loader.loadAsync(url);
  updateModelLOD(gltf.scene);
  const source = fitAxis === 'length' ? rigVehicle(gltf.scene, batchStaticModel) : gltf.scene;

  const box = new Box3().setFromObject(source);
  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  const current = fitAxis === 'height' ? size.y : Math.max(size.x, size.z);
  const scale = current > 1e-6 ? targetSize / current : 1;
  source.scale.setScalar(scale);

  // Modelni markazlashtiramiz va pastki qirrasini nolga qo'yamiz, shunda
  // uni yerga qo'yish uchun faqat `position.y = groundY` yetarli.

  // Ba'zi modellar uzun o'qi bo'ylab X ga qaragan. Bizning konvensiya —
  // "oldinga" = +Z, shuning uchun kerak bo'lsa buramiz.
  const wrapper = new Group();
  // VehicleRig already determines +Z from named front/rear axles, not a bounding-box guess.
  source.updateMatrixWorld(true);
  box.setFromObject(source);
  box.getCenter(center);
  source.position.set(-center.x, -box.min.y, -center.z);
  wrapper.add(source);

  wrapper.traverse((child) => {
    if(child instanceof SkinnedMesh&&url.includes('/reference/')){
      // Conservative animated bounds include swimming, gestures and seated poses.
      // Off-screen characters can then be culled without clipping moving limbs.
      child.boundingSphere=new Sphere(new Vector3(0,.9,0),2.2);child.frustumCulled=true;child.userData.characterBounds=true;
    }
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = false;
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) dropTransmission(material);
    }
  });

  return { object: wrapper, animations: gltf.animations };
}

/**
 * `transmission` li shisha oddiy shaffof shishaga aylantiriladi.
 *
 * Sahnada bitta shunday material bo'lsa ham three har kadr butun shaffof
 * bo'lmagan sahnani alohida render-targetga QAYTA chizadi, va bu o'tishning
 * shaderlari birinchi kadrda sinxron bog'lanib, Windows/ANGLE'da ekranni
 * ~4 soniya qotirardi. Ko'cha masshtabida sinish farqi ko'rinmaydi.
 */
function dropTransmission(material: Material): void {
  if (!(material instanceof MeshPhysicalMaterial) || material.transmission <= 0) return;
  material.transmission = 0;
  material.transparent = true;
  material.opacity = 0.35;
  material.depthWrite = false;
  material.needsUpdate = true;
}

/** Static car parts sharing a material become one draw call. Skinning is never merged. */
export function batchStaticModel(source: Group): Group {
  source.updateMatrixWorld(true);
  const batches = new Map<string, { material: Material; geometries: BufferGeometry[] }>();
  const originals = new Set<BufferGeometry>();
  source.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const full = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    full.applyMatrix4(child.matrixWorld);
    const groups = child.geometry.groups.length ? child.geometry.groups : [{ start: 0, count: full.getAttribute('position').count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]!;
      const geometry = full.clone();
      for (const name of Object.keys(geometry.attributes)) {
        const attribute = geometry.getAttribute(name);
        geometry.setAttribute(name, new BufferAttribute(
          attribute.array.slice(group.start * attribute.itemSize, (group.start + group.count) * attribute.itemSize),
          attribute.itemSize, attribute.normalized,
        ));
      }
      geometry.clearGroups();
      const key = material.uuid + ':' + Object.keys(geometry.attributes).sort().join(',');
      const batch = batches.get(key) ?? { material, geometries: [] as BufferGeometry[] };
      batch.geometries.push(geometry);
      batches.set(key, batch);
    }
    full.dispose();
    originals.add(child.geometry);
  });
  const result = new Group();
  for (const { material, geometries } of batches.values()) {
    const merged = mergeGeometries(geometries, false);
    if (merged) {
      result.add(new Mesh(merged, material));
      for (const geometry of geometries) geometry.dispose();
    } else {
      for (const geometry of geometries) result.add(new Mesh(geometry, material));
    }
  }
  for (const geometry of originals) geometry.dispose();
  return result;
}

/** Skeletons are independent; immutable geometry and textures stay shared. */
export function cloneModel(model: LoadedModel): LoadedModel {
  return { object: clone(model.object) as Group, animations: model.animations };
}

const footVertices = new WeakMap<BufferGeometry, number[]>();
const footVertex = new Vector3();
/**
 * Modelni eng past nuqtasi `footY` ga tushadigan qilib ko'taradi/tushiradi.
 *
 * Namuna vertekslari BOG'LANISH POZASIDAN (bind pose) tanlanadi — ya'ni
 * `geometry.position` ning o'zidan, chunki o'sha pozada skinning aynan shu
 * qiymatlarni qaytaradi. Avval ular JONLI pozadan tanlanardi va natija
 * qachon birinchi kadr tushganiga bog'liq edi: agar o'sha lahzada bir oyoq
 * ko'tarilgan bo'lsa, keshga faqat ikkinchi oyoq tushardi va yurish
 * siklining yarmida personaj o'sha ko'tarilgan oyoq balandligicha YERGA
 * BOTIB ketardi. Bog'lanish pozasida ikkala tovon bir sathda, shuning uchun
 * tanlov har ikkalasini ham qamrab oladi va poza bilan o'zgarmaydi.
 *
 * Kesh geometriya bo'yicha: klonlar geometriyani baham ko'radi, demak
 * skanerlash butun shahar uchun bir marta bajariladi.
 */
export function alignCharacterFeet(object: Object3D, footY: number, preserveFlight = false): void {
  object.updateMatrixWorld(true);
  let bottom = Infinity;
  object.traverseVisible((child) => {
    if (!(child instanceof SkinnedMesh)) return;
    if(!child.userData.characterBounds)child.frustumCulled = false;
    else {if(!child.geometry.boundingBox)child.geometry.computeBoundingBox();if(child.geometry.boundingBox!.min.y>.25)return;}
    let indices = footVertices.get(child.geometry);
    if (!indices) {
      const position = child.geometry.getAttribute('position');
      // Dunyo o'qidagi Y bo'yicha tartiblaymiz: model faqat Y atrofida
      // buriladi, shuning uchun tartib kadrdan kadrga o'zgarmaydi.
      const heights = new Float32Array(position.count);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < position.count; i++) {
        footVertex.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(child.matrixWorld);
        heights[i] = footVertex.y;
        if (footVertex.y < min) min = footVertex.y;
        if (footVertex.y > max) max = footVertex.y;
      }
      // Bo'yning 6% i — taxminan tovon qalinligi. Mutlaq santimetr emas,
      // chunki modellar turli o'lchamga moslanadi.
      const band = min + (max - min) * 0.06;
      indices = [];
      for (let i = 0; i < position.count; i++) if (heights[i]! <= band) indices.push(i);
      footVertices.set(child.geometry, indices);
    }
    for (const index of indices) {
      child.getVertexPosition(index, footVertex).applyMatrix4(child.matrixWorld);
      bottom = Math.min(bottom, footVertex.y);
    }
  });
  if (Number.isFinite(bottom)) object.position.y += preserveFlight ? Math.max(0,footY-bottom) : footY-bottom;
}

/** Piyoda personaj. Bo'yi ~1.8 m, yurish animatsiyasi bilan. */
export function loadCharacter(): Promise<LoadedModel> {
  const requested = new URLSearchParams(location.search).get('avatar') ?? 'yigit';
  const id = ['yigit', 'qiz', 'ishbilarmon', 'ishchi'].includes(requested) ? requested : 'yigit';
  const height = id === 'qiz' ? 1.7 : id === 'ishchi' ? 1.83 : id === 'ishbilarmon' ? 1.78 : 1.8;
  return loadFitted(`/models/reference/${id}.glb`, height, 'height');
}

/**
 * Ko'chadagi odamlar.
 *
 * Bo'ylar ataylab har xil: bir xil bo'yli olomon sun'iy ko'rinadi. Hammasi
 * Quaternius CC0 — nafaqat piyoda bo'lib yuradi, balki NPC transportida
 * haydovchi ham bo'ladi, chunki suyak nomlari bitta oilaga tegishli.
 */
export async function loadPedestrians(): Promise<LoadedModel[]> {
  return Promise.all([
    loadFitted('/models/reference/qiz.glb', 1.7, 'height'),
    loadFitted('/models/reference/yigit.glb', 1.8, 'height'),
    loadFitted('/models/reference/ishchi.glb', 1.83, 'height'),
    loadFitted('/models/reference/ishbilarmon.glb', 1.78, 'height'),
  ]);
}

/** Yengil avtomobil. Uzunligi ~4.5 m. */
export async function loadVehicle(): Promise<LoadedModel> {
  const gltf = await loader.loadAsync('/models/reference/sedan.glb');
  updateModelLOD(gltf.scene);
  gltf.scene.userData.vehicleId = 'sedan';
  gltf.scene.traverse(node => {
    if (node instanceof Mesh) node.castShadow = true;
    if (node.userData.brakeLight || node.userData.indicator) node.visible = false;
  });
  return { object: gltf.scene, animations: gltf.animations };
}

export const MODEL_ATTRIBUTION =
  'Personajlar: MakeHuman / MPFB CC0 aktivlari; yurish va yugurish: CMU motion capture. Sedan, SUV va velosiped: Xarita modellari. Daraxtlar: Quaternius (CC0); Suzuki: Paul Spooner; AC: Poly by Google; skameyka: Ev Amitay; chiroq: Zsky (CC BY 3.0). Manbalar: /models/credits.html';
