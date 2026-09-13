import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  ShapeUtils,
  Vector2,
} from 'three';

import { type TileCoord, tileUvToLonLat } from '@xarita/geo';

import type { OsmTileData } from './OsmSource.ts';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import { WINDOW_HEIGHT, facadeTexture } from './facade.ts';
import { type TreeMeshes, buildTrees, disposeTrees } from './trees.ts';
import { buildingStyle } from './BuildingStyle.ts';
import { asphaltTexture, roofTexture } from './SurfaceMaterials.ts';
import { ownsQuantizedPolygon, ownsQuantizedSegment } from './TileOwnership.ts';
import { waterSurfaceLevel } from './WaterZones.ts';
import { isNavoiLake, referenceTreeExclusion } from './LakeReference.ts';
import { HOKIMIYAT_IDS, hokimiyatTreeExclusion } from './HokimiyatReference.ts';
import { FARXOD_IDS, farxodTreeExclusion, farxodAreaExclusion } from './FarxodReference.ts';
import { SOFTEX_IDS, softexTreeExclusion } from './SoftexReference.ts';
import { buildCityDetails, disposeCityDetails, type BuildingDetail } from './CityDetails.ts';
import { insidePolygon } from './RoadNetwork.ts';
import { XD_BUILDING_IDS, xdAreaExclusion, xdRoadExclusion, xdTreeExclusion } from './XalqlarDostligiReference.ts';

/**
 * Yer ustidagi yassi qatlamlar: chuqurlik siljishi.
 *
 * `lift` endi HAMMASIDA nol. Har qanday ko'tarish — hatto 4 sm ham —
 * personajning oyog'ini va g'ildirakni asfalt ostida qoldiradi: fizika
 * sirti relyefning O'ZI, qatlam esa undan yuqorida chizilardi. Qatlamlar
 * relyefning aynan o'sha uchburchaklariga qirqilgani uchun (`pushTerrainTriangle`)
 * ular endi sirt bilan bir tekislikda yotadi va tartibni butunlay
 * `polygonOffset` ushlab turadi.
 *
 * `step` — yagona vosita. Bir necha santimetr balandlik farqi yaqinda
 * ishlaydi, uzoqda emas: kamera 1..1400 m bo'lgani uchun 24-bitli chuqurlik
 * buferining qadami 400 m da ~1 sm, 1000 m da ~6 sm. Ya'ni uzoqdagi yo'l,
 * yo'lak va yer qoplamasi bitta chuqurlik qiymatiga tushib "laparlaydi"
 * (z-fighting). `polygonOffset` chuqurlikni BUFER BIRLIGIDA suradi, shuning
 * uchun tartib har qanday masofada saqlanadi. U butun chizish chaqiruvi uchun
 * o'rnatiladi — shu sababli har bir qatlam alohida mesh bo'lishi shart.
 *
 * Tartib pastdan yuqoriga: umumiy yer → mahalla → yashillik → maysa →
 * maydoncha/avtoturargoh → suv → yo'lka → piyoda yo'llari → ko'chalar →
 * magistrallar → yo'l chiziqlari. Ya'ni kattaroq yuza kichigining TAGIDA
 * qoladi — xaritada ham, ko'zga ham tabiiy tartib shu.
 */
interface SurfaceLayer {
  /** Relyefdan balandlik, metr. Nol: qatlam sirtning o'zida yotadi. */
  lift: number;
  /** `polygonOffset` bosqichi: manfiy — kameraga yaqinroq. */
  step: number;
}
const LAYER = {
  land: { lift: 0, step: -1 },
  built: { lift: 0, step: -2 },
  greenery: { lift: 0, step: -3 },
  grass: { lift: 0, step: -4 },
  facility: { lift: 0, step: -5 },
  water: { lift: 0, step: -6 },
  paving: { lift: 0, step: -7 },
  path: { lift: 0, step: -8 },
  street: { lift: 0, step: -9 },
  main: { lift: 0, step: -10 },
  curb: { lift: 0.015, step: -10.5 },
  marking: { lift: 0.025, step: -11 },
} as const satisfies Record<string, SurfaceLayer>;
type LayerName = keyof typeof LAYER;

/**
 * Yer qoplamasi sinfi qaysi qatlamga tushadi.
 *
 * OSM'da yuzalar bir-birining ICHIDA yotadi: `landuse=residential` mahallasi
 * ustida maysa, uning ustida sport maydonchasi va avtoturargoh. Bitta tayl
 * ichida shunday juftliklar mingdan ortiq — ular bir sathda chizilganda
 * uzoqdan butun kvartal "laparlab" turardi. Endi har ichki qatlam o'zining
 * ustida.
 */
const AREA_LAYERS: Record<string, LayerName> = {
  farmland: 'land', bare: 'land', sand: 'land', scrub: 'land', urban: 'land',
  residential: 'built', industrial: 'built',
  park: 'greenery', forest: 'greenery',
  grass: 'grass',
  pitch: 'facility', parking: 'facility',
};

/**
 * Yo'l sinfi qaysi qatlamga tushadi.
 *
 * Bir qatlam ichida kesishgan yo'llar baribir bir tekislikda yotadi, lekin
 * ular bir xil rangda va bir xil teksturada — ustma-ust tushishi ko'zga
 * ko'rinmaydi. Ko'rinadigani turli RANGDAGI yuzalar edi: och kulrang yo'lka
 * qora asfalt ustida, sarg'ish yo'lakcha ko'cha ustida. Ular endi ajratilgan.
 */
const ROAD_LAYERS: Record<string, LayerName> = {
  motorway: 'main', trunk: 'main', primary: 'main', secondary: 'main',
  tertiary: 'street', residential: 'street', living_street: 'street',
  unclassified: 'street', service: 'street',
  track: 'path', pedestrian: 'path', footway: 'path', path: 'path',
  cycleway: 'path', steps: 'path',
};

/** Yassi qatlam materiali: chuqurlik siljishi qatlam tartibini kafolatlaydi. */
function surfaceMaterial(
  layer: SurfaceLayer,
  options: MeshStandardMaterialParameters,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    ...options,
    polygonOffset: true,
    // Qiyshiq qaraganda `factor` (yuza qiyaligi) ishlaydi, tikka qaraganda
    // `units` (bufer qadami) — ikkalasi ham kerak.
    polygonOffsetFactor: layer.step,
    polygonOffsetUnits: layer.step * 3,
  });
}

const BUILDING_VARIATION = 0.18;

/** Asfalt kunduzi qora emas, o'rta kulrang — aks holda shahar to'r bilan qoplanadi. */
const ROAD_COLORS: Record<string, number> = {
  motorway: 0x7e7e84,
  trunk: 0x7c7c82,
  primary: 0x78787e,
  secondary: 0x74747a,
  tertiary: 0x707076,
  residential: 0x6c6c72,
  living_street: 0x6c6c72,
  unclassified: 0x6a6a70,
  service: 0x66666b,
  track: 0x7f755e,
  pedestrian: 0x8c8579,
  footway: 0x898174,
  path: 0x81796a,
  cycleway: 0x6d7282,
  steps: 0x898174,
};

/** Yer qoplamasi ranglari — makonni "o'qiladigan" qiladi. */
const AREA_COLORS: Record<string, number> = {
  park: 0x5e7d47,
  grass: 0x6d8a4f,
  pitch: 0x4f7a41,
  forest: 0x40602f,
  scrub: 0x6f7a4a,
  farmland: 0x8a8447,
  sand: 0xc8bfa0,
  bare: 0x9a9080,
  residential: 0x8f8672,
  urban: 0x8a8274,
  industrial: 0x7d7a74,
  parking: 0x74747a,
};

export interface CityTileParts {
  buildings: number;
  triangles: number;
}

/**
 * Mini-xarita uchun 2D ma'lumot: shahar freymidagi `x, z` juftliklari.
 *
 * Nima uchun alohida saqlanadi: mini-xarita har kadr chiziladi, va 3D
 * geometriyadan qayta hisoblash (kvantlangan tayl koordinatasi → lat/lon →
 * ECEF → mahalliy metr) har nuqta uchun bir necha trigonometrik amal degani.
 * Tayl qurilayotganda bir marta yig'ib qo'yish ancha arzon.
 */
export interface CityMapData {
  roads: Array<{ cls: string; width: number; pts: Float32Array; id?: number; name?: string; oneway?: number; elevated?: boolean }>;
  buildings: Float32Array[];
  water: Float32Array[];
  areas: Array<{ cls: string; pts: Float32Array }>;
}

function emptyMapData(): CityMapData {
  return { roads: [], buildings: [], water: [], areas: [] };
}

/**
 * Bitta OSM taylining shahar geometriyasi.
 *
 * Sayyora versiyasidan farqi: verteks koordinatalari to'g'ridan-to'g'ri
 * SHAHAR freymidagi metrlarda, hech qanday markazga nisbatan emas.
 * Shuning uchun mesh transformi umuman kerak emas — hammasi bitta fazoda.
 * Shahar 20 km bo'lgani uchun `float32` da bu millimetr aniqlikda.
 */
export class CityTile {
  readonly coord: TileCoord;
  readonly group = new Group();
  readonly stats: CityTileParts;
  /** Devor geometriyasi — fizika collideri shundan quriladi. */
  readonly wallPositions: Float32Array | null;
  /** Mini-xarita uchun 2D konturlar. */
  readonly map: CityMapData;

  private readonly meshes: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  private trees: TreeMeshes | null = null;
  private details: Group | null = null;
  private readonly detailContext: Context;
  private detailFocus={x:Infinity,z:Infinity};
  private disposed = false;

  constructor(coord: TileCoord, data: OsmTileData, frame: CityFrame, ground: Ground) {
    this.coord = coord;
    this.map = emptyMapData();
    const c0: number[] = [0, 0, 0];
    const c1: number[] = [0, 0, 0];
    const c2: number[] = [0, 0, 0];
    const c3: number[] = [0, 0, 0];
    frame.toLocalArray({ ...tileUvToLonLat(coord, 0, 0), alt: 0 }, c0);
    frame.toLocalArray({ ...tileUvToLonLat(coord, 1, 0), alt: 0 }, c1);
    frame.toLocalArray({ ...tileUvToLonLat(coord, 0, 1), alt: 0 }, c2);
    frame.toLocalArray({ ...tileUvToLonLat(coord, 1, 1), alt: 0 }, c3);
    const xdRoad = xdRoadExclusion(frame);
    const farxodArea = farxodAreaExclusion(frame);
    const xdArea = xdAreaExclusion(frame);
    const excludeLake=referenceTreeExclusion(frame),excludeHokimiyat=hokimiyatTreeExclusion(frame),excludeFarxod=farxodTreeExclusion(frame),excludeSoftex=softexTreeExclusion(frame),excludeXd=xdTreeExclusion(frame);
    const context: Context = {
      coord, extent: data.extent, frame, ground, map: this.map, buildings: [],
      bounds: {
        minX: Math.min(c0[0]!, c1[0]!, c2[0]!, c3[0]!),
        maxX: Math.max(c0[0]!, c1[0]!, c2[0]!, c3[0]!),
        minZ: Math.min(c0[2]!, c1[2]!, c2[2]!, c3[2]!),
        maxZ: Math.max(c0[2]!, c1[2]!, c2[2]!, c3[2]!),
      },
      excludeRoad: (p, road) => xdRoad(p, road),
      excludeArea: (p) => farxodArea(p) || xdArea(p),
      excludeProps: (p) => excludeXd(p) || excludeFarxod(p),
    };
    this.detailContext=context;

    let triangles = 0;

    // Tartib muhim: yuza -> suv -> yo'l. Ular deyarli bir tekislikda yotadi,
    // shuning uchun har biri o'z qatlamida — `LAYER` ga qarang.
    for (const { layer, geometry } of buildAreas(data, context)) {
      triangles += geometry.getAttribute('position').count / 3;
      this.addMesh(geometry, surfaceMaterial(layer, { vertexColors: true, roughness: 1 })).receiveShadow = true;
    }

    const water = buildWater(data, context);
    if (water) {
      triangles += water.getAttribute('position').count / 3;
      this.addMesh(
        water,
        surfaceMaterial(LAYER.water, { color: 0x35617f, roughness: 0.35, metalness: 0.05 }),
      );
    }

    for (const { layer, geometry } of buildRoads(data, context)) {
      triangles += geometry.getAttribute('position').count / 3;
      // Yo'l soyani QABUL QILADI, lekin o'zi tashlamaydi: u yassi va yerga
      // yopishgan, soyasi baribir ko'rinmasdi, hisoblash esa bekorga ketardi.
      const isGrass = layer === LAYER.grass;
      this.addMesh(
        geometry,
        surfaceMaterial(layer, { vertexColors: true, map: isGrass ? null : asphaltTexture(), roughness: isGrass ? 1 : 0.95 }),
      ).receiveShadow = true;
    }

    const built = buildBuildings(data, context);
    if (built) {
      triangles += built.walls.getAttribute('position').count / 3;
      triangles += built.roofs.getAttribute('position').count / 3;

      const facadeMaterial = new MeshStandardMaterial({ vertexColors:true, map:facadeTexture(), roughness:.85 });
      // Four architectural facade families share one draw call. Not surveyed facade imagery.
      facadeMaterial.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute float facade; varying float vFacade;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
        shader.fragmentShader = 'varying float vFacade;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          vec2 facadeUv = vec2(vMapUv.x, (clamp(fract(vMapUv.y), 0.004, 0.996) + vFacade) * 0.25);
          diffuseColor *= texture2D(map, facadeUv);
        `);
      };
      facadeMaterial.customProgramCacheKey = () => 'navoiy-facades-v2';
      const walls = this.addMesh(
        built.walls,
        facadeMaterial,
      );
      walls.castShadow = true;
      walls.receiveShadow = true;

      const roofs = this.addMesh(
        built.roofs,
        new MeshStandardMaterial({ vertexColors: true, map:roofTexture(), roughness: 0.95, metalness: 0 }),
      );
      roofs.castShadow = true;
      roofs.receiveShadow = true;
    }

    // Daraxtlar oxirida: ular yo'l va yuza konturlariga tayanadi, ular esa
    // yuqoridagi qadamlarda `context.map` ga yig'ilgan.
    this.trees = buildTrees(this.map, ground, context.bounds, p=>excludeLake(p)||excludeHokimiyat(p)||excludeFarxod(p)||excludeSoftex(p)||excludeXd(p));
    if (this.trees) {
      this.group.add(...this.trees.meshes);
      triangles += this.trees.count * 12;
    }

    this.wallPositions = built
      ? new Float32Array([...built.wallPositions, ...built.roofs.getAttribute('position').array])
      : null;
    this.stats = { buildings: data.buildings.length, triangles: Math.round(triangles) };
  }

  updateDetails(focus:{x:number;z:number}):void {
    if(Math.hypot(focus.x-this.detailFocus.x,focus.z-this.detailFocus.z)<100)return;
    this.detailFocus={x:focus.x,z:focus.z};
    if(this.details){this.group.remove(this.details);disposeCityDetails(this.details);}
    const context=this.detailContext;
    this.details=buildCityDetails(this.map,context.buildings,context.ground,context.bounds,focus,context.excludeProps);
    this.group.add(this.details);
  }

  private addMesh(
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
  ): Mesh<BufferGeometry, MeshStandardMaterial> {
    const mesh = new Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.meshes.push(mesh);
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes.length = 0;
    if(this.details)disposeCityDetails(this.details);
    if (this.trees) {
      disposeTrees(this.trees);
      this.trees = null;
    }
    this.group.clear();
  }
}

interface Context {
  coord: TileCoord;
  extent: number;
  frame: CityFrame;
  ground: Ground;
  map: CityMapData;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: BuildingDetail[];
  excludeRoad?: (p: { x: number; z: number }, road?: { id?: number; c?: string }) => boolean;
  excludeArea?: (p: { x: number; z: number }) => boolean;
  /** Muallif landmarki o'z chiroq/skameykalarini qo'ygan zona. */
  excludeProps?: (p: { x: number; z: number }) => boolean;
}

/** Kvantlangan tayl koordinatasini shahar metrlariga aylantiradi (balandliksiz). */
function toGround(context: Context, qx: number, qy: number, out: number[]): void {
  const { lat, lon } = tileUvToLonLat(context.coord, qx / context.extent, qy / context.extent);
  context.frame.toLocalArray({ lat, lon, alt: 0 }, out);
}

/**
 * Yer sirtidagi nuqta: gorizontal joyi freymdan, balandligi relyefdan.
 *
 * Balandlikni to'g'ridan-to'g'ri `Ground` dan olamiz (DEM'dan qayta emas) —
 * shunda geometriya relyef meshi bilan AYNAN bir sathda yotadi va suzib
 * qolmaydi.
 */
function toSurface(context: Context, qx: number, qy: number, lift: number, out: number[]): void {
  toGround(context, qx, qy, out);
  out[1] = context.ground.heightAt(out[0]!, out[2]!) + lift;
}

function buildBuildings(
  data: OsmTileData,
  context: Context,
): { roofs: BufferGeometry; walls: BufferGeometry; wallPositions: Float32Array } | null {
  if (data.buildings.length === 0) return null;

  // Tom va devor alohida geometriya: devorga fasad teksturasi va UV kerak,
  // tomga esa yo'q. Bitta materialga birlashtirish tomlarni ham deraza
  // naqshi bilan qoplab qo'yardi.
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  const wallPos: number[] = [];
  const wallNormals: number[] = [];
  const wallColors: number[] = [];
  const wallUvs: number[] = [];
  const facadeIds: number[] = [];

  const contour: Vector2[] = [];
  const color = new Color();
  const p0: number[] = [0, 0, 0];
  const p1: number[] = [0, 0, 0];
  const p2: number[] = [0, 0, 0];

  for (const building of data.buildings) {
    const ring = building.r;
    const count = ring.length / 2;
    if (count < 3) continue;

    const last = count - 1;
    const closed = ring[0] === ring[last * 2] && ring[1] === ring[last * 2 + 1];
    const n = closed ? count - 1 : count;
    if (n < 3) continue;

    // OSM da halqa yo'nalishi kafolatlanmagan. Normallashtirmasak devor
    // normallari binoning ichiga qarab qoladi va bino qora bo'lib ko'rinadi.
    const order = ringOrder(ring, n);

    // Butun bino bitta sathda tursin: balandlik markazdan olinadi.
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += ring[i * 2]!;
      sumY += ring[i * 2 + 1]!;
    }
    // Balandlik markazdan olinadi (butun bino bir sathda tursin), lekin
    // POYDEVOR kontur bo'ylab eng past nuqtagacha tushiriladi — aks holda
    // nishab joyda binoning bir burchagi havoda osilib qoladi.
    toGround(context, sumX / n, sumY / n, p0);
    const ground = context.ground.heightAt(p0[0]!, p0[2]!);
    let lowest = ground;
    for (let i = 0; i < n; i++) {
      toGround(context, ring[i * 2]!, ring[i * 2 + 1]!, p1);
      const h = context.ground.heightAt(p1[0]!, p1[2]!);
      if (h < lowest) lowest = h;
    }
    const baseY = (building.m > 0 ? ground + building.m : lowest) - 0.3;
    const topY = ground + Math.max(building.h, building.m + 2.5);

    // Mini-xarita uchun tekis kontur (ordered).
    const footprint = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const index = order[i]!;
      toGround(context, ring[index * 2]!, ring[index * 2 + 1]!, p0);
      footprint[i * 2] = p0[0]!;
      footprint[i * 2 + 1] = p0[2]!;
    }
    context.map.buildings.push(footprint);
    // The photo-authored landmark owns visual geometry AND colliders for these exact IDs.
    if (building.id !== undefined && (HOKIMIYAT_IDS.has(building.id) || FARXOD_IDS.has(building.id) || SOFTEX_IDS.has(building.id) || XD_BUILDING_IDS.has(building.id))) continue;
    if (context.excludeArea?.({ x: p0[0]!, z: p0[2]! })) continue;
    // Data mini-xarita/fizika uchun saqlanadi, ammo ko'rinadigan bino faqat
    // bitta taylda bo'ladi. Aks holda chegaradagi devor va tomlar qimirlaydi.
    if (!ownsQuantizedPolygon({ x: context.coord.x, y: context.coord.y, extent: context.extent }, ring)) continue;

    let footprintArea=0;
    for(let i=0;i<n;i++){const j=(i+1)%n;footprintArea+=footprint[i*2]!*footprint[j*2+1]!-footprint[j*2]!*footprint[i*2+1]!;}
    footprintArea=Math.abs(footprintArea)/2;

    const style = buildingStyle(building);
    const seed = hash2(building.id ?? Math.round(footprint[0]!), building.id ?? Math.round(footprint[1]!));
    context.buildings.push({ring:footprint,base:ground,top:topY,kind:building.kind??'yes',floors:style.levels??Math.round((topY-ground)/3.2),seed});
    const wallColor = new Color(style.wall);
    if (!building.colour) wallColor.offsetHSL(0, 0, (seed - 0.5) * BUILDING_VARIATION);
    color.set(style.roof);
    if (!building.roofColour) color.offsetHSL((seed-.5)*.025,0,(seed-.5)*.12);

    // --- Tom ---
    contour.length = 0;
    for (let i = 0; i < n; i++) {
      const index = order[i]!;
      contour.push(new Vector2(ring[index * 2]!, ring[index * 2 + 1]!));
    }
    const pitched = style.pitchedRoof && isConvex(footprint);
    if (pitched) {
      const rise=Math.max(.65,Math.min(2.4,Math.sqrt(footprintArea)*.16));
      const centre=[footprint.reduce((s,v,i)=>i%2===0?s+v:s,0)/n,topY+rise,
        footprint.reduce((s,v,i)=>i%2===1?s+v:s,0)/n];
      for(let i=0;i<n;i++){
        const j=(i+1)%n;
        const a=[footprint[i*2]!,topY,footprint[i*2+1]!];
        const b=[footprint[j*2]!,topY,footprint[j*2+1]!];
        pushRoofFace(positions,normals,colors,color,centre,a,b);
      }
    } else for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      const va = contour[a!]!, vb = contour[b!]!, vc = contour[c!]!;
      toGround(context, va.x, va.y, p0); toGround(context, vb.x, vb.y, p1); toGround(context, vc.x, vc.y, p2);
      p0[1] = topY; p1[1] = topY; p2[1] = topY;
      pushRoofFace(positions,normals,colors,color,p0,p1,p2);
    }

    // --- Devorlar ---
    const bottom0: number[] = [0, 0, 0];
    const bottom1: number[] = [0, 0, 0];
    // Bino perimetri bo'ylab yig'ilgan masofa — UV uzluksiz bo'lishi uchun.
    let wallDistance = 0;
    const parapet=!pitched && footprintArea>180 &&
      (['apartments','office','commercial','retail','hospital','school'].includes(building.kind ?? '') || footprintArea>800);
    for (let i = 0; i < n; i++) {
      const a0 = order[i]!;
      const a1 = order[(i + 1) % n]!;
      toGround(context, ring[a0 * 2]!, ring[a0 * 2 + 1]!, bottom0);
      toGround(context, ring[a1 * 2]!, ring[a1 * 2 + 1]!, bottom1);

      const x0 = bottom0[0]!;
      const z0 = bottom0[2]!;
      const x1 = bottom1[0]!;
      const z1 = bottom1[2]!;

      // Devor normali: qirraga perpendikulyar, gorizontal.
      //
      // Halqa yuqoridan CCW ga normallashtirilgan. Qirra vektori (dx, 0, dz)
      // va "yuqori" (0, 1, 0) ning ko'paytmasi tashqariga qaraydi:
      //   (dx, 0, dz) x (0, 1, 0) = (-dz, 0, dx)
      // Belgini teskari qo'yish devor normalini binoning ichiga qaratadi va
      // bino qop-qora bo'lib ko'rinadi — avval aynan shu xato bo'lgan.
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;

      const quad = [
        x0, baseY, z0,
        x1, baseY, z1,
        x0, topY, z0,
        x1, baseY, z1,
        x1, topY, z1,
        x0, topY, z0,
      ];
      wallPos.push(...quad);
      for (let k = 0; k < 6; k++) {
        wallNormals.push(nx, 0, nz);
        wallColors.push(wallColor.r, wallColor.g, wallColor.b);
        // CanvasTexture is vertically flipped on upload.
        facadeIds.push(3-style.facade);
      }

      // UV real metrda: `u` devor bo'ylab masofa, `v` balandlik. Shunda
      // deraza katagi har bir binoda bir xil fizik o'lchamda chiqadi va
      // qavatlar soni binoning haqiqiy balandligini ko'rsatadi.
      const u0 = wallDistance / (style.windowWidth * 4);
      const u1 = (wallDistance + len) / (style.windowWidth * 4);
      const v0 = 0;
      const v1 = style.levels ? style.levels / 4 : (topY - baseY) / (WINDOW_HEIGHT * 4);
      if (style.windows) wallUvs.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
      else for (let k = 0; k < 6; k++) wallUvs.push(0.01, 0.01);
      if(parapet){
        wallPos.push(x0,topY,z0,x1,topY,z1,x0,topY+.38,z0,x1,topY,z1,x1,topY+.38,z1,x0,topY+.38,z0);
        for(let k=0;k<6;k++){wallNormals.push(nx,0,nz);wallColors.push(color.r,color.g,color.b);wallUvs.push(.01,.01);facadeIds.push(3);}
      }
      wallDistance += len;
    }
  }

  const roofs = finish(positions, normals, colors);
  const walls = finish(wallPos, wallNormals, wallColors, wallUvs);
  if (!roofs || !walls) return null;
  walls.setAttribute('facade', new BufferAttribute(new Float32Array(facadeIds),1));
  planarUvs(roofs, 1/18);
  return { roofs, walls, wallPositions: new Float32Array(wallPos) };
}

/** Bir qatlamga yig'iladigan uchburchaklar. */
interface Sink { positions: number[]; normals: number[]; colors: number[] }

/** Yer sirtiga yopishtirilgan to'rtburchak — relyef uchburchaklari bo'yicha kesiladi. */
function pushQuad(
  sink: Sink, context: Context, layer: SurfaceLayer, color: Color,
  a: number[], b: number[], c: number[], d: number[],
): void {
  const added = pushTerrainTriangle(sink.positions, a, b, c, context, layer.lift)
    + pushTerrainTriangle(sink.positions, b, d, c, context, layer.lift);
  for (let k = 0; k < added; k++) {
    sink.normals.push(0, 1, 0);
    sink.colors.push(color.r, color.g, color.b);
  }
}

export interface SurfaceGeometry { layer: SurfaceLayer; geometry: BufferGeometry }

function buildRoads(data: OsmTileData, context: Context): SurfaceGeometry[] {
  if (data.roads.length === 0) return [];

  const sinks = new Map<LayerName, Sink>();
  const sinkFor = (name: LayerName): Sink => {
    let sink = sinks.get(name);
    if (!sink) sinks.set(name, sink = { positions: [], normals: [], colors: [] });
    return sink;
  };

  const color = new Color();
  const pavingColor = new Color(0xb7afa0);
  const curbColor = new Color(0xd5d2c8);
  const markingColor = new Color(0.78, 0.76, 0.67);
  const markingYellowColor = new Color(0.92, 0.71, 0.17);
  const grassColor = new Color(AREA_COLORS.grass ?? 0x5a7d44);

  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];
  const d: number[] = [0, 0, 0];
  const start: number[] = [0, 0, 0];
  const end: number[] = [0, 0, 0];

  // Intersections detection across paved roads
  const junctionNodes = new Set<string>();
  const nodeSeen = new Set<string>();
  for (const road of data.roads) {
    if (!['primary', 'secondary', 'tertiary', 'residential'].includes(road.c)) continue;
    const n = road.p.length / 2;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      const k = `${road.p[i * 2]},${road.p[i * 2 + 1]}`;
      if (nodeSeen.has(k)) junctionNodes.add(k);
      else nodeSeen.add(k);
    }
  }

  for (const road of data.roads) {
    const path = road.p;
    const count = path.length / 2;
    if (count < 2) continue;

    color.setHex(ROAD_COLORS[road.c] ?? 0x6c6c72);
    const half = road.w / 2;

    // Mini-xarita uchun yo'l chizig'i.
    const line = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      toGround(context, path[i * 2]!, path[i * 2 + 1]!, start);
      line[i * 2] = start[0]!;
      line[i * 2 + 1] = start[2]!;
    }
    context.map.roads.push({ cls: road.c, width: road.w, pts: line,
      ...(road.id === undefined ? {} : { id: road.id }), name: road.n ?? '',
      oneway: road.o ?? 0, elevated: !!road.b || !!road.t });
    // DEM has no bridge deck heights: do not invent a floating 4 m surface.
    const layer = LAYER[ROAD_LAYERS[road.c] ?? 'street'];
    const surface = sinkFor(ROAD_LAYERS[road.c] ?? 'street');
    const paved = ['primary', 'secondary', 'tertiary', 'residential'].includes(road.c);

    for (let i = 0; i < count - 1; i++) {
      if (!ownsQuantizedSegment({ x: context.coord.x, y: context.coord.y, extent: context.extent }, path[i * 2]!, path[i * 2 + 1]!, path[i * 2 + 2]!, path[i * 2 + 3]!)) continue;
      toGround(context, path[i * 2]!, path[i * 2 + 1]!, start);
      toGround(context, path[i * 2 + 2]!, path[i * 2 + 3]!, end);

      const midX = (start[0]! + end[0]!) * 0.5, midZ = (start[2]! + end[2]!) * 0.5;
      if (context.excludeRoad?.({ x: midX, z: midZ }, road)) continue;

      // Endi metrlarda ishlaymiz — yo'l eni to'g'ridan-to'g'ri metr.
      const dx = end[0]! - start[0]!;
      const dz = end[2]! - start[2]!;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;

      const nxUnit = -dz / length, nzUnit = dx / length;
      const px = nxUnit * half;
      const pz = nzUnit * half;
      // Segment uchlarini yarim en ga uzaytiramiz — burchaklarda qo'shni
      // segmentlar bir-birini qoplab, tirqish qolmaydi.
      const ex = (dx / length) * half;
      const ez = (dz / length) * half;

      const kStart = `${path[i * 2]},${path[i * 2 + 1]}`;
      const kEnd = `${path[i * 2 + 2]},${path[i * 2 + 3]}`;
      const startIsJunction = junctionNodes.has(kStart);
      const endIsJunction = junctionNodes.has(kEnd);

      const segments = Math.ceil(length / 8);
      for (let segment = 0; segment < segments; segment++) {
        const t0 = segment / segments, t1 = (segment + 1) / segments;
        const x0 = start[0]! + dx * t0 - (segment === 0 ? ex : 0);
        const z0 = start[2]! + dz * t0 - (segment === 0 ? ez : 0);
        const x1 = start[0]! + dx * t1 + (segment === segments - 1 ? ex : 0);
        const z1 = start[2]! + dz * t1 + (segment === segments - 1 ? ez : 0);
        setPoint(a, x0 + px, z0 + pz, context, layer.lift);
        setPoint(b, x0 - px, z0 - pz, context, layer.lift);
        setPoint(c, x1 + px, z1 + pz, context, layer.lift);
        setPoint(d, x1 - px, z1 - pz, context, layer.lift);
        pushQuad(surface, context, layer, color, a, b, c, d);

        // Raised 3D-effect curbs along road edges separating asphalt and sidewalk/lawn
        if (paved) {
          const curbW = 0.22;
          for (const side of [-1, 1]) {
            const innerEdge = half - 0.04;
            const outerEdge = half + curbW;
            const nx0 = nxUnit * side, nz0 = nzUnit * side;
            setPoint(a, x0 + nx0 * innerEdge, z0 + nz0 * innerEdge, context, LAYER.curb.lift);
            setPoint(b, x0 + nx0 * outerEdge, z0 + nz0 * outerEdge, context, LAYER.curb.lift);
            setPoint(c, x1 + nx0 * innerEdge, z1 + nz0 * innerEdge, context, LAYER.curb.lift);
            setPoint(d, x1 + nx0 * outerEdge, z1 + nz0 * outerEdge, context, LAYER.curb.lift);
            pushQuad(sinkFor('curb'), context, LAYER.curb, curbColor, a, b, c, d);
          }
        }

        // Sidewalk paving or green median beside mapped carriageways
        if (paved) for (const side of [-1, 1]) {
          const nx = nxUnit * side, nz = nzUnit * side;
          const isMedianSide = road.o === 1 && side === -1 && road.w >= 8;
          const targetSink = isMedianSide ? sinkFor('grass') : sinkFor('paving');
          const targetLayer = isMedianSide ? LAYER.grass : LAYER.paving;
          const targetColor = isMedianSide ? grassColor : pavingColor;
          const spanW = isMedianSide ? 2.8 : 2.4;

          setPoint(a, x0 + nx * (half + .22), z0 + nz * (half + .22), context, targetLayer.lift);
          setPoint(b, x0 + nx * (half + .22 + spanW), z0 + nz * (half + .22 + spanW), context, targetLayer.lift);
          setPoint(c, x1 + nx * (half + .22), z1 + nz * (half + .22), context, targetLayer.lift);
          setPoint(d, x1 + nx * (half + .22 + spanW), z1 + nz * (half + .22 + spanW), context, targetLayer.lift);
          pushQuad(targetSink, context, targetLayer, targetColor, a, b, c, d);
        }
      }

      // Pedestrian zebra crosswalks and stop lines at road intersections
      const hasZebraStart = paved && road.w >= 6 && length >= 14 && startIsJunction;
      const hasZebraEnd = paved && road.w >= 6 && length >= 14 && endIsJunction;

      if (hasZebraStart) {
        const zStart = 4.2, zLen = 3.6, stripeW = 0.44, stripeStep = 0.88;
        const halfZebra = half - 0.45;
        for (let off = -halfZebra; off + stripeW <= halfZebra; off += stripeStep) {
          const sx0 = start[0]! + dx * (zStart / length) + nxUnit * off;
          const sz0 = start[2]! + dz * (zStart / length) + nzUnit * off;
          const sx1 = sx0 + dx * (zLen / length);
          const sz1 = sz0 + dz * (zLen / length);
          setPoint(a, sx0 + nxUnit * stripeW, sz0 + nzUnit * stripeW, context, LAYER.marking.lift);
          setPoint(b, sx0, sz0, context, LAYER.marking.lift);
          setPoint(c, sx1 + nxUnit * stripeW, sz1 + nzUnit * stripeW, context, LAYER.marking.lift);
          setPoint(d, sx1, sz1, context, LAYER.marking.lift);
          pushQuad(sinkFor('marking'), context, LAYER.marking, markingColor, a, b, c, d);
        }
        const stopDist = zStart + zLen + 1.8;
        if (stopDist + 0.45 < length) {
          const st0 = stopDist / length, st1 = (stopDist + 0.45) / length;
          setPoint(a, start[0]! + dx * st0 + nxUnit * halfZebra, start[2]! + dz * st0 + nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(b, start[0]! + dx * st0 - nxUnit * halfZebra, start[2]! + dz * st0 - nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(c, start[0]! + dx * st1 + nxUnit * halfZebra, start[2]! + dz * st1 + nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(d, start[0]! + dx * st1 - nxUnit * halfZebra, start[2]! + dz * st1 - nzUnit * halfZebra, context, LAYER.marking.lift);
          pushQuad(sinkFor('marking'), context, LAYER.marking, markingColor, a, b, c, d);
        }
      }

      if (hasZebraEnd) {
        const zEndStart = length - 7.8, zLen = 3.6, stripeW = 0.44, stripeStep = 0.88;
        const halfZebra = half - 0.45;
        for (let off = -halfZebra; off + stripeW <= halfZebra; off += stripeStep) {
          const sx0 = start[0]! + dx * (zEndStart / length) + nxUnit * off;
          const sz0 = start[2]! + dz * (zEndStart / length) + nzUnit * off;
          const sx1 = sx0 + dx * (zLen / length);
          const sz1 = sz0 + dz * (zLen / length);
          setPoint(a, sx0 + nxUnit * stripeW, sz0 + nzUnit * stripeW, context, LAYER.marking.lift);
          setPoint(b, sx0, sz0, context, LAYER.marking.lift);
          setPoint(c, sx1 + nxUnit * stripeW, sz1 + nzUnit * stripeW, context, LAYER.marking.lift);
          setPoint(d, sx1, sz1, context, LAYER.marking.lift);
          pushQuad(sinkFor('marking'), context, LAYER.marking, markingColor, a, b, c, d);
        }
        const stopDist = zEndStart - 1.8 - 0.45;
        if (stopDist > 0) {
          const st0 = stopDist / length, st1 = (stopDist + 0.45) / length;
          setPoint(a, start[0]! + dx * st0 + nxUnit * halfZebra, start[2]! + dz * st0 + nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(b, start[0]! + dx * st0 - nxUnit * halfZebra, start[2]! + dz * st0 - nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(c, start[0]! + dx * st1 + nxUnit * halfZebra, start[2]! + dz * st1 + nzUnit * halfZebra, context, LAYER.marking.lift);
          setPoint(d, start[0]! + dx * st1 - nxUnit * halfZebra, start[2]! + dz * st1 - nzUnit * halfZebra, context, LAYER.marking.lift);
          pushQuad(sinkFor('marking'), context, LAYER.marking, markingColor, a, b, c, d);
        }
      }

      // Lane markings and edge lines
      if (road.w >= 7 && paved) {
        const lanes = road.w >= 14 ? 4 : road.w >= 10 ? 3 : 2;
        const dividerOffsets: number[] = [];
        if (lanes === 4) {
          dividerOffsets.push(-half + road.w * 0.25, 0, half - road.w * 0.25);
        } else if (lanes === 3) {
          dividerOffsets.push(-half + road.w * (1 / 3), -half + road.w * (2 / 3));
        } else {
          dividerOffsets.push(0);
        }
        const lineHalf = 0.075;
        const startMargin = hasZebraStart ? 11 : 5;
        const endMargin = hasZebraEnd ? 11 : 5;

        for (const off of dividerOffsets) {
          const offX = nxUnit * off, offZ = nzUnit * off;
          for (let distance = startMargin; distance + 3 < length - endMargin; distance += 9) {
            const x0 = start[0]! + dx * distance / length + offX, z0 = start[2]! + dz * distance / length + offZ;
            const x1 = x0 + dx * 3 / length, z1 = z0 + dz * 3 / length;
            setPoint(a, x0 + nxUnit * lineHalf, z0 + nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(b, x0 - nxUnit * lineHalf, z0 - nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(c, x1 + nxUnit * lineHalf, z1 + nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(d, x1 - nxUnit * lineHalf, z1 - nzUnit * lineHalf, context, LAYER.marking.lift);
            pushQuad(sinkFor('marking'), context, LAYER.marking, markingColor, a, b, c, d);
          }
        }

        // Solid edge lines for roads with width >= 8 (yellow on median side of oneway avenues)
        if (road.w >= 8) {
          for (const side of [-1, 1]) {
            const isMedianLine = road.o === 1 && side === -1;
            const lineCol = isMedianLine ? markingYellowColor : markingColor;
            const edgeOff = (half - 0.28) * side;
            const offX = nxUnit * edgeOff, offZ = nzUnit * edgeOff;
            setPoint(a, start[0]! + offX + nxUnit * lineHalf, start[2]! + offZ + nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(b, start[0]! + offX - nxUnit * lineHalf, start[2]! + offZ - nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(c, end[0]! + offX + nxUnit * lineHalf, end[2]! + offZ + nzUnit * lineHalf, context, LAYER.marking.lift);
            setPoint(d, end[0]! + offX - nxUnit * lineHalf, end[2]! + offZ - nzUnit * lineHalf, context, LAYER.marking.lift);
            pushQuad(sinkFor('marking'), context, LAYER.marking, lineCol, a, b, c, d);
          }
        }
      }
    }
  }

  // Chizish tartibi qatlam bosqichi bo'yicha: pastdagisi oldin.
  const out: SurfaceGeometry[] = [];
  for (const name of Object.keys(LAYER) as LayerName[]) {
    const sink = sinks.get(name);
    if (!sink) continue;
    const geometry = finish(sink.positions, sink.normals, sink.colors);
    if (!geometry) continue;
    planarUvs(geometry, 1 / 3);
    out.push({ layer: LAYER[name], geometry });
  }
  return out;
}

function planarUvs(geometry:BufferGeometry, scale:number):void {
  const positions=geometry.getAttribute('position'), uvs=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i++){uvs[i*2]=positions.getX(i)*scale;uvs[i*2+1]=positions.getZ(i)*scale;}
  geometry.setAttribute('uv',new BufferAttribute(uvs,2));
}

function isConvex(ring:Float32Array):boolean {
  const n=ring.length/2; let sign=0;
  for(let i=0;i<n;i++){
    const a=i*2,b=((i+1)%n)*2,c=((i+2)%n)*2;
    const cross=(ring[b]!-ring[a]!)*(ring[c+1]!-ring[b+1]!)-(ring[b+1]!-ring[a+1]!)*(ring[c]!-ring[b]!);
    if(Math.abs(cross)<.01)continue;
    const current=Math.sign(cross);if(sign&&current!==sign)return false;sign=current;
  }
  return sign!==0;
}

function pushRoofFace(out:number[], normals:number[], colors:number[], color:Color, a:number[],b:number[],c:number[]):void {
  const start=out.length;pushUpFacing(out,a,b,c);
  const ax=out[start]!,ay=out[start+1]!,az=out[start+2]!;
  const bx=out[start+3]!,by=out[start+4]!,bz=out[start+5]!;
  const cx=out[start+6]!,cy=out[start+7]!,cz=out[start+8]!;
  const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;
  for(let k=0;k<3;k++){normals.push(nx,ny,nz);colors.push(color.r,color.g,color.b);}
}

function buildAreas(data: OsmTileData, context: Context): SurfaceGeometry[] {
  const areas = data.areas ?? [];
  if (areas.length === 0) return [];

  const grouped = new Map<LayerName, PolygonItem[]>();
  for (const area of areas) {
    const name = AREA_LAYERS[area.c] ?? 'land';
    let items = grouped.get(name);
    if (!items) grouped.set(name, items = []);
    items.push({ ring: area.r, color: AREA_COLORS[area.c] ?? 0x837c6c, cls: area.c });
  }

  // `LAYER` tartibida yuramiz: mini-xarita konturlari ham shu tartibda
  // yig'iladi, ya'ni u yerda ham fon avval, tafsilot keyin chiziladi.
  const out: SurfaceGeometry[] = [];
  for (const name of Object.keys(LAYER) as LayerName[]) {
    const items = grouped.get(name);
    if (!items) continue;
    const layer = LAYER[name];
    const geometry = buildPolygons(items, context, layer.lift);
    if (geometry) out.push({ layer, geometry });
  }

  // Sport maydonchalari va avtoturargohlar uchun chiziqlar (LAYER.marking)
  const markingSink: Sink = { positions: [], normals: [], colors: [] };
  const white = new Color(0.92, 0.92, 0.92);
  const p0: number[] = [0, 0, 0];
  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];
  const d: number[] = [0, 0, 0];

  for (const area of areas) {
    if (area.c !== 'pitch' && area.c !== 'parking') continue;
    const ring = area.r;
    const count = ring.length / 2;
    if (count < 4) continue;
    if (!ownsQuantizedPolygon({ x: context.coord.x, y: context.coord.y, extent: context.extent }, ring)) continue;

    const n = count - 1;
    const pts: Array<{ x: number; z: number }> = [];
    let isExcluded = false;
    for (let i = 0; i < n; i++) {
      toGround(context, ring[i * 2]!, ring[i * 2 + 1]!, p0);
      if (context.excludeArea?.({ x: p0[0]!, z: p0[2]! })) { isExcluded = true; break; }
      pts.push({ x: p0[0]!, z: p0[2]! });
    }
    if (isExcluded || pts.length < 3) continue;

    if (area.c === 'pitch') {
      // 1. Maydon chetki oq chiziqlari (touchlines)
      for (let i = 0; i < pts.length; i++) {
        const pA = pts[i]!;
        const pB = pts[(i + 1) % pts.length]!;
        const dx = pB.x - pA.x, dz = pB.z - pA.z;
        const len = Math.hypot(dx, dz);
        if (len < 5) continue;
        const nx = (-dz / len) * 0.12, nz = (dx / len) * 0.12;
        setPoint(a, pA.x + nx, pA.z + nz, context, LAYER.marking.lift);
        setPoint(b, pA.x - nx, pA.z - nz, context, LAYER.marking.lift);
        setPoint(c, pB.x + nx, pB.z + nz, context, LAYER.marking.lift);
        setPoint(d, pB.x - nx, pB.z - nz, context, LAYER.marking.lift);
        pushQuad(markingSink, context, LAYER.marking, white, a, b, c, d);
      }

      // 2. Maydon o'rta chizig'i va markaziy doira (to'rtburchak maydonlar uchun)
      if (pts.length === 4) {
        const len0 = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.z - pts[0]!.z);
        const len1 = Math.hypot(pts[2]!.x - pts[1]!.x, pts[2]!.z - pts[1]!.z);
        const isLong0 = len0 > len1;
        const midA = isLong0
          ? { x: (pts[0]!.x + pts[1]!.x) * 0.5, z: (pts[0]!.z + pts[1]!.z) * 0.5 }
          : { x: (pts[1]!.x + pts[2]!.x) * 0.5, z: (pts[1]!.z + pts[2]!.z) * 0.5 };
        const midB = isLong0
          ? { x: (pts[3]!.x + pts[2]!.x) * 0.5, z: (pts[3]!.z + pts[2]!.z) * 0.5 }
          : { x: (pts[0]!.x + pts[3]!.x) * 0.5, z: (pts[0]!.z + pts[3]!.z) * 0.5 };

        const cdx = midB.x - midA.x, cdz = midB.z - midA.z;
        const clen = Math.hypot(cdx, cdz);
        if (clen > 4) {
          const cnx = (-cdz / clen) * 0.12, cnz = (cdx / clen) * 0.12;
          setPoint(a, midA.x + cnx, midA.z + cnz, context, LAYER.marking.lift);
          setPoint(b, midA.x - cnx, midA.z - cnz, context, LAYER.marking.lift);
          setPoint(c, midB.x + cnx, midB.z + cnz, context, LAYER.marking.lift);
          setPoint(d, midB.x - cnx, midB.z - cnz, context, LAYER.marking.lift);
          pushQuad(markingSink, context, LAYER.marking, white, a, b, c, d);

          // Markaziy aylana
          const center = { x: (midA.x + midB.x) * 0.5, z: (midA.z + midB.z) * 0.5 };
          const radius = Math.min(len0, len1) * 0.14;
          const segs = 16;
          for (let s = 0; s < segs; s++) {
            const th0 = (s / segs) * Math.PI * 2;
            const th1 = ((s + 1) / segs) * Math.PI * 2;
            const p0x = center.x + Math.cos(th0) * radius, p0z = center.z + Math.sin(th0) * radius;
            const p1x = center.x + Math.cos(th1) * radius, p1z = center.z + Math.sin(th1) * radius;
            const edx = p1x - p0x, edz = p1z - p0z, elen = Math.hypot(edx, edz);
            if (elen < 0.05) continue;
            const enx = (-edz / elen) * 0.1, enz = (edx / elen) * 0.1;
            setPoint(a, p0x + enx, p0z + enz, context, LAYER.marking.lift);
            setPoint(b, p0x - enx, p0z - enz, context, LAYER.marking.lift);
            setPoint(c, p1x + enx, p1z + enz, context, LAYER.marking.lift);
            setPoint(d, p1x - enx, p1z - enz, context, LAYER.marking.lift);
            pushQuad(markingSink, context, LAYER.marking, white, a, b, c, d);
          }
        }
      }
    } else if (area.c === 'parking') {
      // 3. Avtoturargoh chiziqlari (Parking stall dividers)
      let maxLen = 0, bestEdge = 0;
      for (let i = 0; i < pts.length; i++) {
        const pA = pts[i]!, pB = pts[(i + 1) % pts.length]!;
        const l = Math.hypot(pB.x - pA.x, pB.z - pA.z);
        if (l > maxLen) { maxLen = l; bestEdge = i; }
      }
      if (maxLen >= 9) {
        const pA = pts[bestEdge]!, pB = pts[(bestEdge + 1) % pts.length]!;
        const edx = (pB.x - pA.x) / maxLen, edz = (pB.z - pA.z) / maxLen;
        let inx = -edz, inz = edx;
        const flatPts = new Float32Array(pts.flatMap(p => [p.x, p.z]));
        const testMid = { x: (pA.x + pB.x) * 0.5 + inx * 2, z: (pA.z + pB.z) * 0.5 + inz * 2 };
        if (!insidePolygon(testMid, flatPts)) {
          inx = -inx; inz = -inz;
        }

        const stallW = 2.6;
        const stallL = 4.8;
        const stallNormX = -inz * 0.06, stallNormZ = inx * 0.06;
        for (let dDist = 2.5; dDist + stallW <= maxLen - 1.5; dDist += stallW) {
          const sx = pA.x + edx * dDist, sz = pA.z + edz * dDist;
          const ex = sx + inx * stallL, ez = sz + inz * stallL;
          setPoint(a, sx + stallNormX, sz + stallNormZ, context, LAYER.marking.lift);
          setPoint(b, sx - stallNormX, sz - stallNormZ, context, LAYER.marking.lift);
          setPoint(c, ex + stallNormX, ez + stallNormZ, context, LAYER.marking.lift);
          setPoint(d, ex - stallNormX, ez - stallNormZ, context, LAYER.marking.lift);
          pushQuad(markingSink, context, LAYER.marking, white, a, b, c, d);
        }
      }
    }
  }

  if (markingSink.positions.length > 0) {
    const markingGeometry = finish(markingSink.positions, markingSink.normals, markingSink.colors);
    if (markingGeometry) out.push({ layer: LAYER.marking, geometry: markingGeometry });
  }

  return out;
}

/**
 * Suv yuzasi — halqa bo'yicha YASSI, relyefga yopishtirilmagan.
 *
 * Qolgan yuzalar relyef uchburchaklari bo'yicha kesiladi, suv esa aksincha:
 * u gorizontal bo'lishi kerak. Sathi `waterLevel` bilan bir xil qoidada
 * (qirg'oq bo'ylab eng past nuqta) hisoblanadi — `Ground` tubni aynan shu
 * sathdan o'yadi, shuning uchun yuza va tub hech qachon ajralmaydi.
 */
function buildWater(data: OsmTileData, context: Context): BufferGeometry | null {
  if (data.water.length === 0) return null;

  const positions: number[] = [];
  const normals: number[] = [];
  const contour: Vector2[] = [];
  const point: number[] = [0, 0, 0];

  for (const item of data.water) {
    const ring = item.r;
    const count = ring.length / 2;
    if (count < 4) continue;
    const n = count - 1;
    const order = ringOrder(ring, n);

    contour.length = 0;
    for (let i = 0; i < n; i++) {
      const index = order[i]!;
      contour.push(new Vector2(ring[index * 2]!, ring[index * 2 + 1]!));
    }
    if (contour.length < 3) continue;

    // Kontur mahalliy metrlarda + qirg'oq balandliklari.
    const outline = new Float32Array(contour.length * 2);
    const banks: number[] = [];
    for (let i = 0; i < contour.length; i++) {
      const v = contour[i]!;
      toGround(context, v.x, v.y, point);
      outline[i * 2] = point[0]!;
      outline[i * 2 + 1] = point[2]!;
      banks.push(context.ground.surfaceAt(point[0]!, point[2]!));
    }
    const level = waterSurfaceLevel(banks);
    context.map.water.push(outline);
    // The landmark owns exactly one continuous water surface across tile boundaries.
    const geographic=contour.flatMap(p=>{const ll=tileUvToLonLat(context.coord,p.x/context.extent,p.y/context.extent);return[ll.lon,ll.lat];});
    if(isNavoiLake(geographic))continue;
    if (!ownsQuantizedPolygon({ x: context.coord.x, y: context.coord.y, extent: context.extent }, ring)) continue;
    if (!Number.isFinite(level)) continue;

    const y = level + LAYER.water.lift;
    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      pushUpFacing(positions,
        [outline[a! * 2]!, y, outline[a! * 2 + 1]!],
        [outline[b! * 2]!, y, outline[b! * 2 + 1]!],
        [outline[c! * 2]!, y, outline[c! * 2 + 1]!]);
      for (let k = 0; k < 3; k++) normals.push(0, 1, 0);
    }
  }

  return finish(positions, normals, null);
}

interface PolygonItem { ring: number[]; color: number | null; cls: string }

/** Yassi poligonlar to'plami (yuza, suv) uchun umumiy quruvchi. */
function buildPolygons(
  items: PolygonItem[],
  context: Context,
  lift: number,
): BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const contour: Vector2[] = [];
  const color = new Color();
  const p0: number[] = [0, 0, 0];
  const p1: number[] = [0, 0, 0];
  const p2: number[] = [0, 0, 0];
  let hasColors = false;

  for (const item of items) {
    const ring = item.ring;
    const count = ring.length / 2;
    if (count < 4) continue;
    const n = count - 1;
    const order = ringOrder(ring, n);

    contour.length = 0;
    for (let i = 0; i < n; i++) {
      const index = order[i]!;
      contour.push(new Vector2(ring[index * 2]!, ring[index * 2 + 1]!));
    }
    if (contour.length < 3) continue;

    if (item.color !== null) {
      color.setHex(item.color);
      hasColors = true;
    }

    // Mini-xarita uchun kontur.
    const outline = new Float32Array(contour.length * 2);
    for (let i = 0; i < contour.length; i++) {
      const v = contour[i]!;
      toGround(context, v.x, v.y, p0);
      outline[i * 2] = p0[0]!;
      outline[i * 2 + 1] = p0[2]!;
    }
    if (context.excludeArea && (item.cls === 'pitch' || item.cls === 'parking')) {
      let isExcluded = false;
      for (let i = 0; i < contour.length; i++) {
        if (context.excludeArea({ x: outline[i * 2]!, z: outline[i * 2 + 1]! })) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) continue;
    }
    if (item.cls === 'water') context.map.water.push(outline);
    else context.map.areas.push({ cls: item.cls, pts: outline });
    // To'liq kontur ma'lumoti qoladi; sirtning o'zi esa faqat egasida.
    if (!ownsQuantizedPolygon({ x: context.coord.x, y: context.coord.y, extent: context.extent }, ring)) continue;

    for (const [a, b, c] of ShapeUtils.triangulateShape(contour, [])) {
      const va = contour[a!]!;
      const vb = contour[b!]!;
      const vc = contour[c!]!;
      toSurface(context, va.x, va.y, lift, p0);
      toSurface(context, vb.x, vb.y, lift, p1);
      toSurface(context, vc.x, vc.y, lift, p2);
      const added = pushTerrainTriangle(positions, p0, p1, p2, context, lift);
      for (let k = 0; k < added; k++) {
        normals.push(0, 1, 0);
        if (item.color !== null) colors.push(color.r, color.g, color.b);
      }
    }
  }

  return finish(positions, normals, hasColors ? colors : null);
}

/** Mahalliy (x, z) ga relyef balandligini qo'shib nuqta yasaydi. */
function setPoint(out: number[], x: number, z: number, context: Context, lift: number): void {
  out[0] = x;
  out[1] = context.ground.heightAt(x, z) + lift;
  out[2] = z;
}

/** Clip a surface to the ground's exact triangles: large landuse polygons must not float. */
function pushTerrainTriangle(out: number[], a: number[], b: number[], c: number[], context: Context, lift: number): number {
  const { ground } = context;
  const { bounds, spacingX: sx, spacingZ: sz } = ground;
  const poly = [a, b, c].map((p) => [p[0]!, p[2]!] as [number, number]);
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - bounds.minX) / sx));
  const x1 = Math.min(ground.gridSize - 2, Math.floor((Math.max(...xs) - bounds.minX) / sx));
  const z0 = Math.max(0, Math.floor((Math.min(...zs) - bounds.minZ) / sz));
  const z1 = Math.min(ground.gridSize - 2, Math.floor((Math.max(...zs) - bounds.minZ) / sz));
  const before = out.length;
  for (let row = z0; row <= z1; row++) for (let col = x0; col <= x1; col++) {
    const divisions=ground.detail?.ownsCell(col,row)?ground.detail.divisions:1;
    const cellX=bounds.minX+col*sx,cellZ=bounds.minZ+row*sz;
    const dx=sx/divisions,dz=sz/divisions;
    const subX0=Math.max(0,Math.floor((Math.min(...xs)-cellX)/dx)),subX1=Math.min(divisions-1,Math.floor((Math.max(...xs)-cellX)/dx));
    const subZ0=Math.max(0,Math.floor((Math.min(...zs)-cellZ)/dz)),subZ1=Math.min(divisions-1,Math.floor((Math.max(...zs)-cellZ)/dz));
    for(let sr=subZ0;sr<=subZ1;sr++)for(let sc=subX0;sc<=subX1;sc++) {
    const x=cellX+sc*dx,z=cellZ+sr*dz;
    let clipped = clip(poly, (p) => p[0] - x);
    clipped = clip(clipped, (p) => x + dx - p[0]);
    clipped = clip(clipped, (p) => p[1] - z);
    clipped = clip(clipped, (p) => z + dz - p[1]);
    for (const side of [-1, 1]) {
      const half = clip(clipped, (p) => side * ((p[0] - x) / dx + (p[1] - z) / dz - 1));
      for (let i = 1; i + 1 < half.length; i++) {
        const vertices = [half[0]!, half[i]!, half[i + 1]!].map((p) => [p[0], ground.heightAt(p[0], p[1]) + lift, p[1]]);
        pushUpFacing(out, vertices[0]!, vertices[1]!, vertices[2]!);
      }
    }
    }
  }
  return (out.length - before) / 3;
}

function clip(polygon: Array<[number, number]>, distance: (p: [number, number]) => number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!polygon.length) return out;
  let previous = polygon[polygon.length - 1]!;
  let d0 = distance(previous);
  for (const current of polygon) {
    const d1 = distance(current);
    if ((d0 >= 0) !== (d1 >= 0)) {
      const t = d0 / (d0 - d1);
      out.push([previous[0] + (current[0] - previous[0]) * t, previous[1] + (current[1] - previous[1]) * t]);
    }
    if (d1 >= 0) out.push(current);
    previous = current; d0 = d1;
  }
  return out;
}

/**
 * Gorizontal uchburchakni HAR DOIM yuqoriga qaratib qo'shadi.
 *
 * Yuza yoritilishi uchburchak aylanish yo'nalishiga bog'liq. Halqani oldindan
 * normallashtirish odatda yetarli, lekin triangulyator va OSM ma'lumotidagi
 * chekka holatlar o'tib ketishi mumkin. Bu yerda taxmin qilmaymiz —
 * geometrik normalni o'lchab, kerak bo'lsa ikkita verteksni almashtiramiz.
 */
function pushUpFacing(out: number[], a: number[], b: number[], c: number[]): void {
  const e1x = b[0]! - a[0]!;
  const e1z = b[2]! - a[2]!;
  const e2x = c[0]! - a[0]!;
  const e2z = c[2]! - a[2]!;
  // Y komponentasi: (e1 x e2).y = e1z*e2x - e1x*e2z
  if (e1z * e2x - e1x * e2z >= 0) {
    out.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  } else {
    out.push(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, b[0]!, b[1]!, b[2]!);
  }
}

function finish(
  positions: number[],
  normals: number[],
  colors: number[] | null,
  uvs?: number[],
): BufferGeometry | null {
  if (positions.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  if (colors && colors.length > 0) {
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  }
  if (uvs && uvs.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Halqani yuqoridan qaraganda soat strelkasiga teskari tartibga keltiradi.
 * Tayl koordinatalarida y JANUBGA o'sadi, ya'ni tizim ko'zgu aksi —
 * shuning uchun CCW halqa shoelace formulasida MANFIY yuza beradi.
 */
function ringOrder(ring: number[], n: number): number[] {
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  const order = new Array<number>(n);
  if (area <= 0) for (let i = 0; i < n; i++) order[i] = i;
  else for (let i = 0; i < n; i++) order[i] = n - 1 - i;
  return order;
}

function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
