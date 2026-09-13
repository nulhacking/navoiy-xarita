import {
  Color,
  ConeGeometry,
  IcosahedronGeometry,
  SphereGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';

import type { CityMapData } from './CityTile.ts';
import type { Ground } from './Ground.ts';
import { insidePolygon } from './RoadNetwork.ts';
import { assetTrees } from './TreeAssets.ts';

/** Bitta taylda eng ko'p shuncha daraxt. LOD tizimi 300m dan uzoqni yengil meshga aylantiradi. */
const MAX_TREES = 2400;

/** Ko'cha bo'ylab daraxtlar orasidagi masofa, metr. */
const STREET_SPACING = 11;
/** Daraxt yo'l chetidan shuncha metr narida turadi. */
const STREET_OFFSET = 3.0;

/** Ko'chalari daraxt bilan qoplanadigan sinflar. */
const TREE_LINED = new Set([
  'residential',
  'living_street',
  'unclassified',
  'tertiary',
  'secondary',
  'primary',
]);

/** Yashil zonalarda bitta daraxtga to'g'ri keladigan yuza, m². Sun'iy yo'ldosh fotosuratiga mos. */
const AREA_DENSITY: Record<string, number> = {
  forest: 45,
  park: 75,
  scrub: 140,
  grass: 150,
  pitch: 0, // sport maydonida daraxt bo'lmaydi
  farmland: 0,
};

const FOLIAGE_COLORS = [0x4f7238, 0x5a7d3c, 0x456b34, 0x63864a, 0x3d5f2e];

export interface TreeMeshes {
  meshes: Object3D[];
  count: number;
  sharedAssets?: boolean;
}

export interface TreeBounds { minX: number; maxX: number; minZ: number; maxZ: number }
type TreePoint = { x: number; z: number; scale: number; kind: number; shape: number };

/**
 * Tayl uchun daraxtlar.
 *
 * NIMA UCHUN PROSEDURAVIY: Navoiy uchun OSM'da bitta ham `natural=tree` node
 * yo'q (bake buni tekshirdi — 0 ta). Ammo shahar aslida daraxtzor: ko'chalar
 * ikki tomonlama terak va chinor bilan qoplangan. Shuning uchun daraxtlar
 * yo'l chiziqlari va yashil zonalar konturidan hosil qilinadi.
 *
 * Joylashuv TASODIFIY EMAS: koordinatadan hosil qilingan barqaror qiymat
 * ishlatiladi, shunda tayl qayta yuklanganda daraxtlar joyidan qimirlamaydi.
 */
export function buildTrees(map: CityMapData, ground: Ground, bounds: TreeBounds, exclude?: (p:{x:number;z:number})=>boolean): TreeMeshes | null {
  const points: TreePoint[] = [];

  collectStreetTrees(map, points);
  collectAreaTrees(map, points);

  if (points.length === 0) return null;

  // Chegaradan oshsa, ro'yxatning BOSHINI kesib tashlash noto'g'ri bo'lardi:
  // nomzodlar yo'l-yo'l tartibida yig'iladi, ya'ni daraxtlar taylning bir
  // burchagiga to'planib, qolgan qismi bo'sh qolardi. Buning o'rniga bir
  // tekis qadam bilan siyraklashtiramiz — taqsimot saqlanadi.
  const obstacles = [...map.buildings, ...map.water].map((ring) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
      minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
    }
    return { ring, minX, minZ, maxX, maxZ };
  });
  const roads = map.roads.flatMap((road) => {
    const edges: Array<{ x: number; z: number; dx: number; dz: number; width: number }> = [];
    for (let i = 0; i + 3 < road.pts.length; i += 2) edges.push({
      x: road.pts[i]!, z: road.pts[i+1]!, dx: road.pts[i+2]!-road.pts[i]!, dz: road.pts[i+3]!-road.pts[i+1]!, width: road.width/2 + 1,
    });
    return edges;
  });
  const onRoad = (p: { x: number; z: number }) => roads.some((r) => {
    if (p.x < Math.min(r.x,r.x+r.dx)-r.width || p.x > Math.max(r.x,r.x+r.dx)+r.width ||
      p.z < Math.min(r.z,r.z+r.dz)-r.width || p.z > Math.max(r.z,r.z+r.dz)+r.width) return false;
    const t = Math.max(0, Math.min(1, ((p.x-r.x)*r.dx+(p.z-r.z)*r.dz)/(r.dx*r.dx+r.dz*r.dz || 1)));
    return Math.hypot(p.x-r.x-r.dx*t,p.z-r.z-r.dz*t) < r.width;
  });
  const selected = subsample(points.filter((p) =>
    !exclude?.(p) &&
    p.x >= bounds.minX && p.x < bounds.maxX && p.z >= bounds.minZ && p.z < bounds.maxZ), MAX_TREES * 2).filter((p) =>
    p.x >= bounds.minX && p.x < bounds.maxX && p.z >= bounds.minZ && p.z < bounds.maxZ &&
    !onRoad(p) && !obstacles.some((o) =>
    p.x > o.minX - 2 && p.x < o.maxX + 2 && p.z > o.minZ - 2 && p.z < o.maxZ + 2 &&
    (insidePolygon(p, o.ring) || insidePolygon({ x: p.x + 2, z: p.z }, o.ring) || insidePolygon({ x: p.x - 2, z: p.z }, o.ring))
  )).slice(0, MAX_TREES);
  if (!selected.length) return null;
  const imported=assetTrees(selected,(x,z)=>ground.heightAt(x,z));
  if(imported?.length)return {meshes:imported,count:selected.length,sharedAssets:true};

  const trunkGeometry = new CylinderGeometry(0.14, 0.22, 1, 4);
  // Silindr markazi 0 da — pastki uchini nolga ko'chiramiz, shunda
  // masshtablash daraxtni yerga botirmaydi.
  trunkGeometry.translate(0, 0.5, 0);

  const roundFoliage = new IcosahedronGeometry(1, 1);
  roundFoliage.scale(1, 0.5, 1);
  roundFoliage.translate(0, 0.5, 0);
  // Terak — uzun, ignabargli — konus, chinor/bog' daraxti — keng toj.
  const conicalFoliage = new ConeGeometry(1, 1, 7);
  conicalFoliage.translate(0, 0.5, 0);
  const broadFoliage = new SphereGeometry(1, 10, 7);
  broadFoliage.scale(1.28, 0.55, 1.28);
  broadFoliage.translate(0, 0.55, 0);

  const trunks = new InstancedMesh(
    trunkGeometry,
    new MeshStandardMaterial({ color: 0x6b533a, roughness: 0.95 }),
    selected.length,
  );
  const shapeCounts = [0, 0, 0];
  for (const p of selected) shapeCounts[p.shape]++;
  const foliage = [roundFoliage, conicalFoliage, broadFoliage].map((geometry, shape) => {
    // InstancedMesh 0 sig'im bilan yaratilmaydi; bo'sh tur uchun 1 slot
    // ajratib, faol nusxa sonini 0 qilamiz. Bu hech narsa chizmaydi.
    const mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ roughness: 0.9 }), Math.max(1, shapeCounts[shape]!));
    mesh.count = shapeCounts[shape]!;
    return mesh;
  });
  const shapeIndices = [0, 0, 0];

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const color = new Color();

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i]!;
    const y = ground.heightAt(p.x, p.z);
    // Buta pastroq va kengroq, daraxt baland va ingichka.
    const height = (p.kind === 1 ? 1.7 : 6.5) * p.scale;
    const crown = (p.kind === 1 ? 1.3 : 2.1) * p.scale;
    const trunkHeight = p.kind === 1 ? height * 0.25 : height * 0.42;

    position.set(p.x, y, p.z);
    scale.set(1, trunkHeight, 1);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);

    const crownMesh = foliage[p.shape]!;
    const crownIndex = shapeIndices[p.shape]!++;
    position.set(p.x, y + trunkHeight * 0.75, p.z);
    const verticalCrown = height - trunkHeight * 0.75;
    scale.set(crown, p.shape === 1 ? verticalCrown * 1.35 : p.shape === 2 ? verticalCrown * 0.7 : verticalCrown, crown);
    matrix.compose(position, quaternion, scale);
    crownMesh.setMatrixAt(crownIndex, matrix);

    color.setHex(FOLIAGE_COLORS[(i + p.shape) % FOLIAGE_COLORS.length]!);
    crownMesh.setColorAt(crownIndex, color);
  }

  trunks.instanceMatrix.needsUpdate = true;
  for (const crownMesh of foliage) {
    crownMesh.instanceMatrix.needsUpdate = true;
    if (crownMesh.instanceColor) crownMesh.instanceColor.needsUpdate = true;
  }

  // Soyani faqat barglar tashlaydi: tanasi ingichka, soyasi baribir
  // ko'rinmaydi, lekin soya xaritasiga chizish qimmatga tushadi.
  for (const crownMesh of foliage) {
    crownMesh.castShadow = true;
    crownMesh.receiveShadow = false;
    crownMesh.matrixAutoUpdate = false;
    crownMesh.updateMatrix();
  }
  trunks.castShadow = false;
  trunks.receiveShadow = true;

  trunks.matrixAutoUpdate = false;
  trunks.updateMatrix();

  return { meshes:[trunks,...foliage], count: selected.length };
}

function collectStreetTrees(
  map: CityMapData,
  out: TreePoint[],
): void {
  for (const road of map.roads) {
    if (!TREE_LINED.has(road.cls)) continue;
    const pts = road.pts;
    const offset = road.width / 2 + STREET_OFFSET;

    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i]!;
      const z0 = pts[i + 1]!;
      const dx = pts[i + 2]! - x0;
      const dz = pts[i + 3]! - z0;
      const length = Math.hypot(dx, dz);
      if (length < STREET_SPACING * 0.5) continue;

      const ux = dx / length;
      const uz = dz / length;
      // Yo'lga perpendikulyar.
      const px = -uz;
      const pz = ux;

      for (let d = STREET_SPACING * 0.5; d < length; d += STREET_SPACING) {
        const cx = x0 + ux * d;
        const cz = z0 + uz * d;
        // Ikki tomonda ham. Har biri o'z barqaror "tasodifiyligi" bilan.
        for (const side of [1, -1]) {
          const tx = cx + px * offset * side;
          const tz = cz + pz * offset * side;
          const r = hash2(tx, tz);
          // Tabiiyroq bo'lishi uchun kam qismi bo'sh qoladi
          if (r < 0.16) continue;
          out.push({ x: tx, z: tz, scale: 0.75 + r * 0.5, kind: 0, shape: r < .52 ? 0 : r < .78 ? 1 : 2 });
        }
      }
    }
  }
}

function collectAreaTrees(
  map: CityMapData,
  out: TreePoint[],
): void {
  for (const area of map.areas) {
    const density = AREA_DENSITY[area.cls];
    if (!density) continue;

    const pts = area.pts;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i]! < minX) minX = pts[i]!;
      if (pts[i]! > maxX) maxX = pts[i]!;
      if (pts[i + 1]! < minZ) minZ = pts[i + 1]!;
      if (pts[i + 1]! > maxZ) maxZ = pts[i + 1]!;
    }

    const step = Math.sqrt(density);
    // Juda katta yuzalar (dala) butun taylni qoplab ketmasin.
    if ((maxX - minX) * (maxZ - minZ) > 900_000) continue;

    for (let x = minX + step * 0.5; x < maxX; x += step) {
      for (let z = minZ + step * 0.5; z < maxZ; z += step) {
        const r = hash2(x, z);
        // Panjara ko'rinmasligi uchun har nuqtani biroz siljitamiz.
        const jx = x + (r - 0.5) * step * 0.8;
        const jz = z + (hash2(z, x) - 0.5) * step * 0.8;
        if (!pointInPolygon(jx, jz, pts)) continue;
        out.push({
          x: jx,
          z: jz,
          scale: 0.7 + r * 0.6,
          kind: area.cls === 'scrub' ? 1 : 0,
          shape: area.cls === 'scrub' ? 2 : r < .42 ? 0 : r < .7 ? 1 : 2,
        });
      }
    }
  }
}

/** Bir tekis qadam bilan siyraklashtirish — taqsimotni buzmaydi. */
function subsample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const stride = items.length / limit;
  const out: T[] = new Array(limit);
  for (let i = 0; i < limit; i++) out[i] = items[Math.floor(i * stride)]!;
  return out;
}

/** Juft-toq (even-odd) usuli: nuqtadan chiqqan nur konturni necha marta kesadi. */
function pointInPolygon(x: number, z: number, pts: Float32Array): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]!;
    const zi = pts[i * 2 + 1]!;
    const xj = pts[j * 2]!;
    const zj = pts[j * 2 + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Koordinatadan barqaror [0, 1) qiymat — qayta yuklashda joyi o'zgarmasin. */
function hash2(a: number, b: number): number {
  let h = (Math.round(a * 100) * 374761393 + Math.round(b * 100) * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function disposeTrees(trees: TreeMeshes): void {
  for(const object of trees.meshes)object.traverse(mesh=>{
    if(mesh instanceof Mesh&&mesh.userData.ownedTreeGeometry)mesh.geometry.dispose();
    if(!(mesh instanceof InstancedMesh))return;
    mesh.dispose();
    if(!trees.sharedAssets){mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();}
  });
}
