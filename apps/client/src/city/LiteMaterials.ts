import { Color, Mesh, MeshLambertMaterial, MeshStandardMaterial, SkinnedMesh, type Material, type Object3D } from 'three';

import { LOW_QUALITY } from './Quality.ts';

const BLACK = new Color(0, 0, 0);
const converted = new WeakMap<Material, Material>();

/**
 * Yengil rejimda PBR (`MeshStandardMaterial`) ni `MeshLambertMaterial` ga almashtiradi.
 *
 * Standard material har pikselda GGX yorug'lik integrali va muhit xaritasi
 * namunasini hisoblaydi; Adreno 500-seriyasida bu kadrning eng qimmat qismi.
 * Lambert xuddi shu rang, tekstura, vertex rangi va tuman bilan ishlaydi —
 * shaharning ko'rinishi deyarli o'zgarmaydi, faqat yaltiroq akslar yo'qoladi.
 *
 * Tegilmaydiganlar:
 *   - emissiv materiallar (chiroq linzasi, tungi oyna): modullar ularning
 *     `emissiveIntensity` sini kadrma-kadr o'zgartiradi va eski obyektga
 *     havola saqlaydi — almashtirilsa, tunda chiroqlar yonmay qolardi;
 *   - `userData.dynamic` belgilanganlar (svetofor linzalari — boshida qora);
 *   - skinned meshlar va tayyor chiroq modeli.
 * Bir xil material bir marta aylantiriladi va baham ko'riladi.
 */
export function liteMaterials(root: Object3D, disposeOriginals = false): void {
  if (!LOW_QUALITY) return;
  const replace = (material: Material): Material => {
    const lite = convert(material);
    // Tayl materiallarini boshqa hech kim ushlamaydi: eskisini darhol bo'shatamiz,
    // aks holda har yuklangan taylda xotira oqib ketardi.
    if (disposeOriginals && lite !== material) material.dispose();
    return lite;
  };
  root.traverse((node) => {
    if (!(node instanceof Mesh) || node instanceof SkinnedMesh || node.name === 'street-lamp') return;
    node.material = Array.isArray(node.material) ? node.material.map(replace) : replace(node.material);
  });
}

function convert(material: Material): Material {
  if (!(material instanceof MeshStandardMaterial) || material.userData.dynamic) return material;
  if (!material.emissive.equals(BLACK) && material.emissiveIntensity > 0) return material;
  const cached = converted.get(material);
  if (cached) return cached;
  const lite = new MeshLambertMaterial({
    name: material.name,
    color: material.color,
    map: material.map,
    vertexColors: material.vertexColors,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    fog: material.fog,
    polygonOffset: material.polygonOffset,
    polygonOffsetFactor: material.polygonOffsetFactor,
    polygonOffsetUnits: material.polygonOffsetUnits,
    flatShading: material.flatShading,
  });
  // Fasad atlasi `onBeforeCompile` bilan `map_fragment` ni almashtiradi — u
  // Lambert shaderida ham bor, shuning uchun o'zgartirishsiz ishlaydi.
  lite.onBeforeCompile = material.onBeforeCompile;
  lite.customProgramCacheKey = material.customProgramCacheKey;
  converted.set(material, lite);
  return lite;
}
