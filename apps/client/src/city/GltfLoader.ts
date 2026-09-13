import { BufferAttribute, Mesh, type BufferGeometry } from 'three';
import { GLTFLoader, type GLTFLoaderPlugin } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** Butun son bo'lib qolishi SHART bo'lgan atributlar: suyak indekslari. */
const INTEGER_ATTRIBUTES = new Set(['skinIndex']);

/**
 * Kvantlangan atributlarni Float32 ga qaytaradi.
 *
 * Meshopt siqish pozitsiya, normal va UV larni normallashtirilgan Int8/Int16
 * qilib yozadi. Render uchun bu yaxshi, lekin shahar kodi modellarni
 * `mergeGeometries` bilan birlashtiradi va u bitta atribut uchun bir xil massiv
 * turini talab qiladi — aks holda "consistent array types" xatosi bilan
 * butun partiya tushib qoladi. Tarmoq orqali fayl baribir siqilgan holda keladi.
 */
function dequantize(geometry: BufferGeometry): void {
  const convert = (attribute: BufferAttribute): BufferAttribute => {
    if (attribute.array instanceof Float32Array && !attribute.normalized) return attribute;
    const out = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) {
      for (let k = 0; k < attribute.itemSize; k++) out[i * attribute.itemSize + k] = attribute.getComponent(i, k);
    }
    return new BufferAttribute(out, attribute.itemSize);
  };
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (INTEGER_ATTRIBUTES.has(name)) continue;
    geometry.setAttribute(name, convert(attribute as BufferAttribute));
  }
  const morphs = geometry.morphAttributes as Record<string, BufferAttribute[] | undefined>;
  for (const name of Object.keys(morphs)) morphs[name] = morphs[name]?.map(convert);
}

const dequantizePlugin = (): GLTFLoaderPlugin => ({
  name: 'xarita_dequantize',
  afterRoot: async (result) => {
    const seen = new Set<BufferGeometry>();
    result.scene.traverse((node) => {
      if (!(node instanceof Mesh) || seen.has(node.geometry)) return;
      seen.add(node.geometry);
      dequantize(node.geometry);
    });
  },
});

/**
 * Barcha glTF yuklovchilar shu yerdan olinadi.
 *
 * `public/models` dagi fayllar `tools/models/compress.mjs` bilan siqilgan:
 * geometriya EXT_meshopt_compression, teksturalar WebP. Meshopt dekoderi
 * JS/WASM ichida o'rnatilgan — alohida dekoder faylini serverda saqlash
 * shart emas (Draco'dan farqli). Dekodersiz yuklovchi bu fayllarni o'qiy olmaydi.
 */
export function createGltfLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(dequantizePlugin);
}
