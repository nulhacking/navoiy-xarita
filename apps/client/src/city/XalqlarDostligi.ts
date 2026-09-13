import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh,
  MeshStandardMaterial, OctahedronGeometry, Points, PointsMaterial, Quaternion, ShapeUtils, SphereGeometry,
  TorusGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import type { CityFrame } from './CityFrame.ts';
import type { CityMapData } from './CityTile.ts';
import type { Ground } from './Ground.ts';
import { Physics, RAPIER } from './Physics.ts';
import { assetTrees } from './TreeAssets.ts';
import { disposeTrees, type TreeMeshes } from './trees.ts';
import { buildLightPools, buildParkFurniture, disposeCityDetails } from './CityDetails.ts';
import { asphaltTexture, parkPavingTexture } from './SurfaceMaterials.ts';
import {
  XD_BILLBOARDS, XD_BOULEVARD, XD_BUS_STOPS, XD_CROSSINGS, XD_GARLANDS, XD_HOTEL, XD_JUNCTIONS, XD_MALL,
  XD_BEND, XD_JUNCTION, XD_MEMORIAL, XD_POOL, XD_ROAD, XD_SIDE_ENTRIES, XD_SPORT, xdArmBasis, xdBasis, type XdBasis,
} from './XalqlarDostligiReference.ts';

/** Yozuvlar uchun 5x7 bitmap: shrift yuklanmaydi, harflar qutichalardan. */
const GLYPHS: Record<string, string[]> = {
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** Yassi (soya tashlamaydigan) qatlamlar va ularning chuqurlik siljishi. Tayl qatlamlaridan (−1..−11) USTIDA. */
const FLAT: Record<string, number> = {
  soil: -12, lawn: -12.5, paving: -13, pavingDark: -13, brick: -13.5, asphalt: -14, asphaltBay: -14.5,
  water: -15, poolWater: -15, marking: -16, markingYellow: -16,
};

type TreePoint = { x: number; z: number; scale: number; shape: number; kind: number };
type Span = readonly [number, number];

/**
 * Bitta qattiq freym (asosiy ko'cha yoki janubi-sharqiy tarmoq) uchun geometriya
 * yig'uvchi. Guruh ichida `x = u`, `z = v`, `y` — freym boshi balandligidan.
 */
class Site {
  readonly group = new Group();
  readonly parts = new Map<string, BufferGeometry[]>();
  readonly body: RAPIER.RigidBody;
  readonly base: number;

  constructor(readonly basis: XdBasis, private readonly ground: Ground, private readonly physics: Physics,
    name: string, private readonly trees: TreePoint[]) {
    this.base = ground.heightAt(basis.origin.x, basis.origin.z);
    this.group.name = name;
    this.group.position.set(basis.origin.x, this.base, basis.origin.z);
    this.group.rotation.y = Math.atan2(-basis.east.z, basis.east.x);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.group.position.x, this.base, this.group.position.z).setRotation(this.group.quaternion));
  }

  y(u: number, v: number): number {
    const p = this.basis.point(u, v);
    return this.ground.heightAt(p.x, p.z) - this.base;
  }

  add(g: BufferGeometry, key: string): void {
    const flat = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    const p = flat.getAttribute('position'), uv = new Float32Array(p.count * 2);
    const scale = key === 'asphalt' || key === 'asphaltBay' ? 1 / 3 : .25;
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * scale; uv[i * 2 + 1] = p.getZ(i) * scale; }
    flat.setAttribute('uv', new BufferAttribute(uv, 2));
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    const bucket = this.parts.get(key) ?? [];
    bucket.push(flat);
    this.parts.set(key, bucket);
  }

  box(u: number, y: number, v: number, w: number, h: number, d: number, key: string, collide = false, yaw = 0): void {
    const g = new BoxGeometry(w, h, d);
    if (yaw) g.rotateY(yaw);
    this.add(g.translate(u, y, v), key);
    if (collide) {
      const desc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(u, y, v);
      if (yaw) desc.setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
      this.physics.world.createCollider(desc, this.body);
    }
  }

  /** Relyefda turgan quti: `h` yerdan yuqoriga, poydevor 10 sm yerga botadi. */
  standing(u: number, v: number, w: number, h: number, d: number, key: string, collide = false, yaw = 0): void {
    const y = this.y(u, v);
    this.box(u, y + h / 2 - .05, v, w, h + .1, d, key, collide, yaw);
  }

  cylinder(u: number, v: number, y0: number, h: number, rTop: number, rBottom: number, key: string, segments = 10, collide = false): void {
    this.add(new CylinderGeometry(rTop, rBottom, h, segments).translate(u, y0 + h / 2, v), key);
    if (collide) this.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, Math.max(rTop, rBottom)).setTranslation(u, y0 + h / 2, v), this.body);
  }

  beam(a: Vector3, b: Vector3, r: number, key: string, segments = 6): void {
    const delta = b.clone().sub(a), length = delta.length();
    if (length < 1e-3) return;
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    const p = a.clone().add(b).multiplyScalar(.5);
    this.add(new CylinderGeometry(r, r, length, segments).applyQuaternion(q).translate(p.x, p.y, p.z), key);
  }

  /** Relyefga yopishgan to'rtburchak yuza: katakchalar 8 m dan oshmaydi. */
  surface(u0: number, u1: number, v0: number, v1: number, key: string, lift = .05): void {
    if (u1 - u0 < .01 || v1 - v0 < .01) return;
    const nu = Math.max(1, Math.ceil((u1 - u0) / 8)), nv = Math.max(1, Math.ceil((v1 - v0) / 8));
    const positions = new Float32Array(nu * nv * 18);
    let k = 0;
    const at = (i: number, j: number) => {
      const u = u0 + (u1 - u0) * i / nu, v = v0 + (v1 - v0) * j / nv;
      return [u, this.y(u, v) + lift, v] as const;
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      for (const [a, b] of [[i, j], [i, j + 1], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i + 1, j]] as const) {
        const p = at(a, b);
        positions[k++] = p[0]; positions[k++] = p[1]; positions[k++] = p[2];
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.computeVertexNormals();
    this.add(g, key);
  }

  /** Kichik ixtiyoriy ko'pburchak (maysa parteri, strelka): cho'qqilarda relyef balandligi. */
  polygon(points: ReadonlyArray<readonly [number, number]>, key: string, lift = .05): void {
    const contour = points.map(([u, v]) => new Vector2(u, v));
    const positions: number[] = [];
    // Katta uchburchak relyefga ergashishi uchun 6 m dan kichik bo'laklarga bo'linadi.
    const emit = (a: Vector2, b: Vector2, c: Vector2, depth: number): void => {
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      if (longest > 6 && depth < 6) {
        const ab = a.clone().add(b).multiplyScalar(.5), bc = b.clone().add(c).multiplyScalar(.5), ca = c.clone().add(a).multiplyScalar(.5);
        emit(a, ab, ca, depth + 1); emit(ab, b, bc, depth + 1); emit(ca, bc, c, depth + 1); emit(ab, bc, ca, depth + 1);
        return;
      }
      // Yuqoriga qaragan tartib (CityTile.pushUpFacing bilan bir xil qoida).
      const up = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y) >= 0;
      for (const p of up ? [a, b, c] : [a, c, b]) positions.push(p.x, this.y(p.x, p.y) + lift, p.y);
    };
    for (const tri of ShapeUtils.triangulateShape(contour, [])) emit(contour[tri[0]!]!, contour[tri[1]!]!, contour[tri[2]!]!, 0);
    if (!positions.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.computeVertexNormals();
    this.add(g, key);
  }

  /** Ingichka qiya chiziq (avtoturargoh kataklari, diagonal yo'lak). */
  line(u0: number, v0: number, u1: number, v1: number, width: number, key: string, lift = .06): void {
    const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv) || 1;
    const nu = -dv / len * width / 2, nv = du / len * width / 2;
    this.polygon([[u0 + nu, v0 + nv], [u1 + nu, v1 + nv], [u1 - nu, v1 - nv], [u0 - nu, v0 - nv]], key, lift);
  }

  /** Ixtiyoriy yo'nalishdagi past hajm (egilishdagi bordyur). */
  segment(a: readonly [number, number], b: readonly [number, number], width: number, height: number, key: string, collide: boolean): void {
    const du = b[0] - a[0], dv = b[1] - a[1], length = Math.hypot(du, dv);
    if (length < .05) return;
    const cu = (a[0] + b[0]) / 2, cv = (a[1] + b[1]) / 2, y = this.y(cu, cv);
    this.box(cu, y + height / 2 - .05, cv, width, height + .1, length + .02, key, collide, Math.atan2(du, dv));
  }

  /** v bo'ylab uzun past hajm (bordyur, ajratgich): 8 m bo'laklar relyefga ergashadi. */
  run(u: number, width: number, height: number, v0: number, v1: number, key: string, collide: boolean): void {
    const pieces = Math.max(1, Math.ceil((v1 - v0) / 8));
    const step = (v1 - v0) / pieces;
    for (let i = 0; i < pieces; i++) {
      const cv = v0 + step * (i + .5);
      this.standing(u, cv, width, height, step + .01, key, collide);
    }
  }

  /** Oraliqlarni chiqarib, [v0, v1] ni bo'laklarga ajratadi. */
  static spans(v0: number, v1: number, gaps: Span[]): Span[] {
    let out: Span[] = [[v0, v1]];
    for (const [g0, g1] of gaps) {
      out = out.flatMap(([a, b]): Span[] => (g1 <= a || g0 >= b ? [[a, b]] : [
        ...(g0 > a ? [[a, g0] as const] : []), ...(g1 < b ? [[g1, b] as const] : []),
      ]));
    }
    return out.filter(([a, b]) => b - a > .3);
  }

  tree(u: number, v: number, scale: number, shape: number, collide = true): void {
    const p = this.basis.point(u, v);
    this.trees.push({ x: p.x, z: p.z, scale, shape, kind: 0 });
    if (collide) {
      const y = this.y(u, v);
      this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1, .16).setTranslation(u, y + 1, v), this.body);
    }
  }

  world(u: number, v: number): { x: number; z: number } {
    const p = this.basis.point(u, v);
    return { x: p.x, z: p.z };
  }

  /** Material bo'yicha birlashtirilgan meshlar. */
  finish(materials: Record<string, MeshStandardMaterial>, label: string): void {
    for (const [key, parts] of this.parts) {
      const geometry = mergeGeometries(parts);
      for (const g of parts) g.dispose();
      if (!geometry) continue;
      const mesh = new Mesh(geometry, materials[key] ?? materials.concrete);
      mesh.name = `${label} · ${key}`;
      mesh.castShadow = !(key in FLAT);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.parts.clear();
  }
}

/**
 * Xalqlar Do'stligi shoh ko'chasi — Amir Temur chorrahasidan janubiy chorrahagacha
 * (1.5 km) va undan janubi-sharqqa ketgan tarmoq (0.45 km), ikki tomonidagi
 * trotuar, daraxt qatorlari, xiyobon va birinchi qator landmarklar bilan.
 *
 * Nima o'lchangan va nima baholangan — `XalqlarDostligiReference.ts` da.
 */
export class XalqlarDostligi {
  readonly group = new Group();
  readonly map: CityMapData = { buildings: [], roads: [], water: [], areas: [] };
  readonly basis: XdBasis;
  readonly arm: XdBasis;
  readonly base: number;

  private readonly main: Site;
  private readonly armSite: Site;
  private readonly materials: Record<string, MeshStandardMaterial>;
  private readonly treePoints: TreePoint[] = [];
  private trees: TreeMeshes | null = null;
  private readonly extras: Group[] = [];
  private readonly lens: MeshStandardMaterial[] = [];
  private readonly signalHeads: Array<{ material: MeshStandardMaterial; colour: 'red' | 'amber' | 'green'; offset: number }> = [];
  private readonly lampPoints: Array<{ x: number; z: number }> = [];
  private readonly nozzles: Array<{ u: number; v: number; y: number; reach: number }> = [];
  private readonly jets: Points<BufferGeometry, PointsMaterial>;
  private time = 0;

  constructor(frame: CityFrame, private readonly ground: Ground, physics: Physics) {
    this.basis = xdBasis(frame);
    this.arm = xdArmBasis(frame);
    this.main = new Site(this.basis, ground, physics, "Xalqlar Do'stligi shoh ko'chasi", this.treePoints);
    this.armSite = new Site(this.arm, ground, physics, "Xalqlar Do'stligi · janubi-sharqiy tarmoq", this.treePoints);
    this.base = this.main.base;
    this.group.name = "Xalqlar Do'stligi shoh ko'chasi · satellite + Street View";
    this.group.add(this.main.group, this.armSite.group);

    const mat = (color: number, roughness = .85, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
    this.materials = {
      asphalt: mat(0x6e6f73, .95), asphaltBay: mat(0x7a7a7c, .95),
      marking: mat(0xf2f1ea, .6), markingYellow: mat(0xe2b43a, .6),
      curb: mat(0xe8e6de, .8), concrete: mat(0xbdb8ad, .9), barrier: mat(0xe4e2dc, .85),
      paving: mat(0xd3ccbe, .9), pavingDark: mat(0xaaa396, .92), brick: mat(0xa9714f, .9),
      lawn: mat(0x5d7c3d, 1), soil: mat(0x7d6f58, 1), hedge: mat(0x3e5f2c, 1),
      metal: mat(0x55595c, .5, .6), metalLight: mat(0xc7cacc, .45, .55), dark: mat(0x23282b, .6, .3),
      lampLens: mat(0xfff4da, .3, .1), garland: mat(0xfff0c8, .4, .1),
      glass: mat(0x2b3e46, .15, .45), shelterGlass: mat(0x9fb8c0, .1, .2),
      signBlue: mat(0x1d5ca3, .5, .1), white: mat(0xf2f0e8, .75), red: mat(0xc72b32, .6), green: mat(0x2f8f47, .55),
      billboardA: mat(0x2a6fd1, .5), billboardB: mat(0x7c2742, .5), billboardC: mat(0xe8d24a, .5),
      water: mat(0x2e7486, .15, .2), poolWater: mat(0x2aa3c7, .12, .15), granite: mat(0x77706a, .6),
      stone: mat(0xd9d2c3, .8), bronze: mat(0x5e4a31, .45, .55),
      mallWall: mat(0xdccdae, .85), mallBand: mat(0x8f5b3b, .8), mallGlass: mat(0x33474c, .15, .45),
      rotunda: mat(0xd8c49c, .8), dome: mat(0xa9b4ba, .35, .55),
      hotelWall: mat(0xeceae3, .82), hotelWindow: mat(0x4b5c63, .2, .4),
      sportBand: mat(0x9a5a40, .85), sportTrim: mat(0xd9d2c1, .8), sportGlass: mat(0x2d3c41, .18, .45),
      bannerA: mat(0x2b62a8, .6), bannerB: mat(0xd6a23b, .6), bannerC: mat(0x3a8a55, .6),
      ringBlue: mat(0x0085c7, .5), ringYellow: mat(0xf4c300, .5), ringBlack: mat(0x111111, .5),
      ringGreen: mat(0x009f3d, .5), ringRed: mat(0xdf0024, .5),
      kioskRed: mat(0xb8323a, .6), kioskTeal: mat(0x2f8c8c, .6),
      signalOff: mat(0x141719, .5),
    };
    for (const [key, factor] of Object.entries(FLAT)) {
      const m = this.materials[key]!;
      m.polygonOffset = true;
      m.polygonOffsetFactor = factor;
      m.polygonOffsetUnits = factor * 3;
      m.side = DoubleSide;
      if (key === 'paving' || key === 'pavingDark' || key === 'brick') m.map = parkPavingTexture();
      if (key === 'asphalt' || key === 'asphaltBay') m.map = asphaltTexture();
    }
    // Bordyur va ajratgich USTI yassi qatlamlardan oldinda turishi kerak: asfaltning katta
    // `polygonOffset` i qiya qaralganda 20 sm lik hajmni butunlay yutib yuborardi.
    for (const key of ['curb', 'barrier']) {
      const m = this.materials[key]!;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -17;
      m.polygonOffsetUnits = -51;
    }
    for (const key of ['lampLens', 'garland']) {
      const m = this.materials[key]!;
      m.emissive.setHex(0xffd68a);
      this.lens.push(m);
    }

    this.carriageways();
    this.bend();
    this.sides();
    this.lamps();
    this.garlands();
    this.amirTemurSignals();
    this.busStops();
    this.billboards();
    this.kiosks();
    this.boulevard();
    this.mall();
    this.hotel();
    this.sportSaroyi();
    this.pool();
    this.memorial();
    this.southEastArm();

    this.main.finish(this.materials, 'XD');
    this.armSite.finish(this.materials, 'XD arm');

    // Daraxt va yorug'lik dog'lari dunyo koordinatasida: burilishni bekor qiluvchi tugun ostida.
    const world = new Group();
    world.name = "Xalqlar Do'stligi · world-space";
    this.main.group.add(world);
    world.position.copy(this.main.group.position).negate().applyQuaternion(this.main.group.quaternion.clone().invert());
    world.quaternion.copy(this.main.group.quaternion).invert();
    const meshes = assetTrees(this.treePoints, (x, z) => ground.heightAt(x, z));
    if (meshes) {
      for (const lod of meshes) if (lod.levels[1]) lod.levels[1].distance = 520;
      this.trees = { meshes, count: this.treePoints.length, sharedAssets: true };
      world.add(...meshes);
    }
    const pools = buildLightPools(this.lampPoints, ground);
    world.add(pools);
    this.extras.push(pools);
    const benches = this.boulevardFurniture();
    world.add(benches);
    this.extras.push(benches);

    const spray = new BufferGeometry();
    spray.setAttribute('position', new BufferAttribute(new Float32Array(900 * 3), 3));
    this.jets = new Points(spray, new PointsMaterial({ color: 0xd9f2f4, size: .14, transparent: true, opacity: .55, depthWrite: false }));
    this.jets.name = 'XD · fountain spray';
    this.jets.frustumCulled = false;
    this.main.group.add(this.jets);
    this.update(0, 0);

    this.group.userData = {
      place: "Xalqlar Do'stligi shoh ko'chasi, Navoiy",
      sources: 'Google satellite z19 + Lemala 360 Street View (2024-07) + OSM',
      trees: this.treePoints.length, lamps: this.lampPoints.length,
    };
  }

  // --- qatnov qismi -----------------------------------------------------------

  private junctionGaps(): Span[] {
    return XD_JUNCTIONS.map(j => [j.v0, j.v1] as const);
  }

  private carriageways(): void {
    const s = this.main, R = XD_ROAD;
    // 1. Asfalt: butun kenglik bo'ylab; ajratgich ustiga quriladi.
    s.surface(R.west, R.east, R.north, R.south, 'asphalt', .03);
    s.surface(R.stub.west, R.stub.east, R.stub.north, R.north, 'asphalt', .03);
    // Amir Temur chorrahasi: ko'ndalang ko'chaning qatnov qismi ham shu yerda yopiladi.
    s.surface(-24, R.west, -1166, -1128, 'asphalt', .03);
    s.surface(R.east, 40, -1166, -1128, 'asphalt', .03);
    s.surface(-20, R.west, -562, -541, 'asphalt', .03);
    for (const side of [-1, 1] as const) s.surface(side < 0 ? -22 : R.east, side < 0 ? R.west : 34, 90, 106, 'asphalt', .03);

    // 2. O'rta ajratgich: oq bo'yalgan 1 m beton, chorraha va zebralarda uziladi.
    const crossingGaps = XD_CROSSINGS.map(v => [v - 2.2, v + 2.2] as const);
    const medianU = (R.medianWest + R.medianEast) / 2, medianW = R.medianEast - R.medianWest;
    for (const [a, b] of Site.spans(R.north, R.south, [...this.junctionGaps(), ...crossingGaps])) {
      s.run(medianU, medianW, R.medianHeight, a, b, 'curb', true);
    }

    // 3. Chekka bordyurlar.
    const entryGaps = (side: number) => XD_SIDE_ENTRIES.filter(e => e.side === side).map(e => [e.v0, e.v1] as const);
    const westGaps: Span[] = [...XD_JUNCTIONS.filter(j => j.west).map(j => [j.v0, j.v1] as const), ...entryGaps(-1),
      [XD_BOULEVARD.parking.vMin, XD_BOULEVARD.parking.vMax]];
    const eastGaps: Span[] = [...XD_JUNCTIONS.filter(j => j.east).map(j => [j.v0, j.v1] as const), ...entryGaps(1), [112, 326]];
    for (const [a, b] of Site.spans(R.north, R.south, westGaps)) {
      // Sport Saroyi oldida oq chekka tasma 1 m — chiroqlar shu tasmada turadi.
      const wide = a < 87 && b > -60;
      if (wide) {
        for (const [c, d] of Site.spans(a, b, [[-60, 87]])) s.run(R.west - R.curbWidth / 2, R.curbWidth, R.curbHeight, c, d, 'curb', true);
        s.run(R.west - .5, 1, R.curbHeight, Math.max(a, -60), Math.min(b, 87), 'curb', true);
      } else s.run(R.west - R.curbWidth / 2, R.curbWidth, R.curbHeight, a, b, 'curb', true);
    }
    for (const [a, b] of Site.spans(R.north, R.south, eastGaps)) {
      const wide = a < 87 && b > -40;
      if (wide) {
        for (const [c, d] of Site.spans(a, b, [[-40, 87]])) s.run(R.east + R.curbWidth / 2, R.curbWidth, R.curbHeight, c, d, 'curb', true);
        s.run(R.east + .5, 1, R.curbHeight, Math.max(a, -40), Math.min(b, 87), 'curb', true);
      } else s.run(R.east + R.curbWidth / 2, R.curbWidth, R.curbHeight, a, b, 'curb', true);
    }
    // Shimoliy davomi: ikki tomonlama, bo'yoq bilan bo'lingan.
    s.run(R.stub.west - R.curbWidth / 2, R.curbWidth, R.curbHeight, R.stub.north, R.north - 6, 'curb', true);
    s.run(R.stub.east + R.curbWidth / 2, R.curbWidth, R.curbHeight, R.stub.north, R.north - 6, 'curb', true);
    for (const off of [-.15, .15]) s.surface(R.stub.centre + off - .06, R.stub.centre + off + .06, R.stub.north, R.north, 'marking', .07);

    // 4. Chiziqlar: uzluksiz chekka (oq) va ajratgich yonidagi sariq.
    const noLineGaps = this.junctionGaps();
    for (const [a, b] of Site.spans(R.north, R.south, noLineGaps)) {
      s.surface(R.medianWest - .38, R.medianWest - .23, a, b, 'markingYellow', .07);
      s.surface(R.medianEast + .23, R.medianEast + .38, a, b, 'markingYellow', .07);
      s.surface(R.west + .35, R.west + .5, a, b, 'marking', .07);
      s.surface(R.east - .5, R.east - .35, a, b, 'marking', .07);
    }
    // Bo'lak chiziqlari: 3 m chiziq, 6 m oraliq; zebra va chorraha oldida uzluksiz yo'q.
    const dashGaps: Span[] = [...XD_JUNCTIONS.map(j => [j.v0 - 14, j.v1 + 14] as const), ...XD_CROSSINGS.map(v => [v - 9, v + 9] as const)];
    const dashes = (lanes: readonly number[], v0: number, v1: number, site: Site) => {
      for (const [a, b] of Site.spans(v0, v1, dashGaps)) {
        for (let v = a + 2; v + 3 <= b - 1; v += 9) for (const u of lanes) site.surface(u - .07, u + .07, v, v + 3, 'marking', .07);
      }
    };
    dashes([...R.westLanes, ...R.eastLanes], R.north, R.south, s);
    // To'xtash oldidagi uzluksiz bo'lak chiziqlari (chorrahaga 14 m).
    for (const j of XD_JUNCTIONS) for (const u of [...R.westLanes, ...R.eastLanes]) {
      s.surface(u - .07, u + .07, j.v0 - 14, j.v0 - 6, 'marking', .07);
      s.surface(u - .07, u + .07, j.v1 + 6, j.v1 + 14, 'marking', .07);
    }
    for (let v = R.stub.north + 4; v < R.north - 8; v += 9) for (const u of [1.2, 9.5, 16]) s.surface(u - .07, u + .07, v, v + 3, 'marking', .07);

    // 5. Zebra: har 1 m da 0.5 m oq tasma, 4 m uzunlik; to'xtash chiziqlari yo'nalishga qarab.
    for (const v of XD_CROSSINGS) {
      const west = v < R.north ? R.stub.west : R.west, east = v < R.north ? R.stub.east : R.east;
      for (let u = west + .8; u < east - .6; u += 1) {
        if (u > R.medianWest - .3 && u < R.medianEast + .3 && v > R.north) continue;
        s.surface(u, u + .5, v - 2, v + 2, 'marking', .075);
      }
      s.surface(R.west + .5, R.medianWest - .5, v - 3.9, v - 3.45, 'marking', .075);
      s.surface(R.medianEast + .5, R.east - .5, v + 3.45, v + 3.9, 'marking', .075);
    }
    // 6. Strelkalar: signal chorrahalariga yaqinlashishda.
    for (const j of XD_JUNCTIONS) {
      if (j.v0 > R.north + 10) for (const [i, u] of [-4.2, -.2, 3.8].entries()) this.arrow(s, u, j.v0 - 22, 1, i === 2);
      for (const [i, u] of [16.4, 12.6, 8.8].entries()) this.arrow(s, u, j.v1 + 22, -1, i === 2);
    }
    // 7. Qiya avtoturargohlar (xiyobon oldida va DISKONT qatori oldida).
    const P = XD_BOULEVARD.parking;
    s.surface(P.uMin, R.west, P.vMin + 6, P.vMax - 6, 'asphaltBay', .035);
    s.polygon([[R.west, P.vMin], [R.west, P.vMin + 6], [P.uMin, P.vMin + 6]], 'asphaltBay', .035);
    s.polygon([[R.west, P.vMax], [P.uMin, P.vMax - 6], [R.west, P.vMax - 6]], 'asphaltBay', .035);
    s.run(P.uMin - .25, .5, R.curbHeight, P.vMin + 6, P.vMax - 6, 'curb', true);
    for (let v = P.vMin + 8; v < P.vMax - 8; v += 2.8) s.line(P.uMin + .3, v, R.west - .4, v + 2.2, .1, 'marking', .075);
    s.surface(R.east, 25, 116, R.south, 'asphaltBay', .035);
    s.run(25.25, .5, R.curbHeight, 116, R.south, 'curb', true);
    for (let v = 118; v < R.south - 2; v += 2.8) s.line(24.6, v, R.east + .6, v + 2.6, .1, 'marking', .075);
  }

  private arrow(s: Site, u: number, v: number, dir: 1 | -1, left: boolean): void {
    // `dir` — harakat yo'nalishi v bo'yicha. Uch: v + dir*2.6.
    s.surface(u - .1, u + .1, Math.min(v - dir * 2, v + dir * 1.2), Math.max(v - dir * 2, v + dir * 1.2), 'marking', .075);
    s.polygon([[u - .55, v + dir * 1.2], [u + .55, v + dir * 1.2], [u, v + dir * 2.6]], 'marking', .075);
    if (left) {
      // Chapga burilish: janubga ketayotgan uchun chap = +u, shimolga ketayotgan uchun −u.
      const side = dir;
      s.line(u, v - dir * .2, u + side * 1.0, v + dir * .6, .2, 'marking', .075);
      s.polygon([[u + side * .75, v + dir * .15], [u + side * 1.55, v + dir * .95], [u + side * .7, v + dir * 1.1]], 'marking', .075);
    }
  }

  // --- janubiy egilish va chorraha -----------------------------------------------

  private bend(): void {
    const s = this.main, B = XD_BEND, R = XD_ROAD;
    type Station = { u: number; v: number; nu: number; nv: number };
    const sample = (line: ReadonlyArray<readonly [number, number]>, v: number): Station => {
      let i = 0;
      while (i < line.length - 2 && v > line[i + 1]![1]) i++;
      const [u0, v0] = line[i]!, [u1, v1] = line[i + 1]!;
      const t = (v - v0) / (v1 - v0), du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv) || 1;
      return { u: u0 + du * t, v, nu: dv / len, nv: -du / len };
    };
    const off = (p: Station, d: number) => [p.u + p.nu * d, p.v + p.nv * d] as const;
    const stations: Array<{ sb: Station; nb: Station }> = [];
    for (let v = R.south; v <= B.end + .01; v += 4) stations.push({ sb: sample(B.sb, v), nb: sample(B.nb, v) });
    const quad = (i: number, a: (k: number) => readonly [number, number], b: (k: number) => readonly [number, number], key: string, lift: number) =>
      s.polygon([a(i), b(i), b(i + 1), a(i + 1)], key, lift);
    const W = (k: number, d = 0) => off(stations[k]!.sb, B.sbEdge + d);
    const MW = (k: number, d = 0) => off(stations[k]!.sb, B.sbMedian + d);
    const ME = (k: number, d = 0) => off(stations[k]!.nb, B.nbMedian + d);
    const E = (k: number, d = 0) => off(stations[k]!.nb, B.nbEdge + d);
    for (let i = 0; i + 1 < stations.length; i++) {
      const v = stations[i]!.sb.v;
      quad(i, k => W(k), k => E(k), 'asphalt', .03);
      s.segment(W(i, -.25), W(i + 1, -.25), .5, R.curbHeight, 'curb', true);
      if (v < 330) {
        s.segment(E(i, 6.85), E(i + 1, 6.85), .5, R.curbHeight, 'curb', true);
        quad(i, k => E(k), k => E(k, 6.6), 'asphaltBay', .035);
        const [su, sv] = E(i, 6.2), [eu, ev] = E(i, .6);
        s.line(su, sv, eu, ev + 2.4, .1, 'marking', .075);
        quad(i, k => E(k, 7.1), k => E(k, 11.5), 'paving', .06);
      } else {
        s.segment(E(i, .25), E(i + 1, .25), .5, R.curbHeight, 'curb', true);
        quad(i, k => E(k, .5), k => E(k, 5), 'paving', .06);
      }
      if (v < B.end - 8) {
        const a = MW(i), b = MW(i + 1), c = ME(i), d = ME(i + 1);
        s.segment([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], [(b[0] + d[0]) / 2, (b[1] + d[1]) / 2], 1, R.medianHeight, 'curb', true);
        quad(i, k => MW(k, -.38), k => MW(k, -.23), 'markingYellow', .07);
        quad(i, k => ME(k, .23), k => ME(k, .38), 'markingYellow', .07);
      }
      quad(i, k => W(k, .35), k => W(k, .5), 'marking', .07);
      quad(i, k => E(k, -.5), k => E(k, -.35), 'marking', .07);
      if (i % 2 === 0 && v < B.end - 12) for (const frac of [1 / 3, 2 / 3]) {
        const lerp = (p: readonly [number, number], q: readonly [number, number]) => [p[0] + (q[0] - p[0]) * frac, p[1] + (q[1] - p[1]) * frac] as const;
        const a0 = lerp(W(i), MW(i)), a1 = lerp(W(i + 1), MW(i + 1));
        s.line(a0[0], a0[1], a0[0] + (a1[0] - a0[0]) * .75, a0[1] + (a1[1] - a0[1]) * .75, .14, 'marking', .07);
        const b0 = lerp(ME(i), E(i)), b1 = lerp(ME(i + 1), E(i + 1));
        s.line(b0[0], b0[1], b0[0] + (b1[0] - b0[0]) * .75, b0[1] + (b1[1] - b0[1]) * .75, .14, 'marking', .07);
      }
      // G'arbiy tomonda maysa tasmasi va trotuar.
      quad(i, k => W(k, -4.5), k => W(k, -.5), 'lawn', .05);
      quad(i, k => W(k, -7), k => W(k, -4.5), 'paving', .06);
      if (i % 2 === 1) { const [tu, tv] = W(i, -2.6); s.tree(tu, tv, 1.25, 0); }
      if (i % 9 === 4) {
        const [lu, lv] = W(i, -.25), [eu, ev] = E(i, v < 330 ? 6.85 : .25);
        this.lamp(s, lu, lv, 1, false);
        this.lamp(s, eu, ev, -1, false);
      }
    }
    this.junction();
  }

  private junction(): void {
    const s = this.main, J = XD_JUNCTION;
    s.polygon(J.polygon, 'asphalt', .03);
    for (const z of J.zebras) {
      const du = z.to[0] - z.from[0], dv = z.to[1] - z.from[1], len = Math.hypot(du, dv);
      for (let t = .6; t < len - .4; t += 1) {
        const cu = z.from[0] + du * t / len, cv = z.from[1] + dv * t / len;
        s.line(cu - z.dir[0] * 2, cv - z.dir[1] * 2, cu + z.dir[0] * 2, cv + z.dir[1] * 2, .5, 'marking', .075);
      }
    }
  }

  // --- trotuarlar va daraxt qatorlari -------------------------------------------

  private sides(): void {
    const s = this.main, R = XD_ROAD;
    const walk = (u0: number, u1: number, v0: number, v1: number, key = 'paving') => s.surface(u0, u1, v0, v1, key, .06);
    const row = (u: number, v0: number, v1: number, step: number, scale: number, shape: number, jitter = 0) => {
      for (let v = v0 + step / 2, i = 0; v < v1; v += step, i++) {
        if (XD_CROSSINGS.some(c => Math.abs(c - v) < 3) || XD_SIDE_ENTRIES.some(e => v > e.v0 - 2 && v < e.v1 + 2)) continue;
        const k = Math.sin(i * 12.9898 + u * 78.233) * 43758.5453;
        const r = k - Math.floor(k);
        s.tree(u + (r - .5) * jitter, v, scale * (.88 + r * .24), shape);
      }
    };

    // --- G'arb ---
    // Shimoliy davomi: Hokimiyat bog'i chetidagi oqlangan tanali daraxtlar.
    walk(-8, R.stub.west - .25, R.stub.north, -1172);
    s.surface(-12, -8, R.stub.north, -1172, 'soil', .05);
    row(-10, R.stub.north, -1176, 8, 1.35, 0);
    // Hokimiyat maydoni: tor tasma va oq beton to'siqlar (Street View).
    walk(-9, R.west - .5, -1122, -925);
    for (let v = -1110; v < -955; v += 2.6) s.standing(-8, v, .55, .8, 2.1, 'barrier', true);
    // Xiyobon oldi.
    walk(-13, R.west - .5, -945, XD_BOULEVARD.parking.vMin + 6);
    walk(-13, XD_BOULEVARD.parking.uMin - .5, XD_BOULEVARD.parking.vMin + 6, XD_BOULEVARD.parking.vMax - 6);
    walk(-13, R.west - .5, XD_BOULEVARD.parking.vMax - 6, -566);
    // Xiyobon chetidagi past metall panjara: har ko'ndalang yo'lakda ochiq.
    for (let v = XD_BOULEVARD.vMin + 4; v < XD_BOULEVARD.vMax - 4; v += 2.4) {
      if (((v - XD_BOULEVARD.vMin) % 19.3) < 3) continue;
      s.standing(-13.2, v, .05, .75, .05, 'metal');
      s.box(-13.2, s.y(-13.2, v) + .72, v + 1.2, .05, .05, 2.4, 'metal');
    }
    // O'zbekiston ko'chasidan janubga: daraxt tasmasi va trotuar.
    s.surface(-13, R.west - .5, -537, -300, 'soil', .05);
    walk(-16, -13, -537, -300);
    row(-11, -537, -300, 5.5, 1.15, 0, .8);
    row(-8.3, -537, -300, 11, .95, 3, .4);
    s.surface(-11, R.west - .5, -300, -60, 'lawn', .05);
    walk(-14, -11, -300, -60);
    row(-9, -300, -60, 7, 1.2, 0, .6);
    // Sport Saroyi oldi: to'q plitkali trotuar, oq tasmada chiroqlar.
    walk(-12, R.west - 1, -60, 87, 'pavingDark');
    // Tolstoydan janubga.
    s.surface(-11, R.west - .5, 109, R.south, 'lawn', .05);
    walk(-14, -11, 109, R.south);
    row(-8.8, 126, R.south, 8, 1.25, 0, .6);

    // --- Sharq ---
    walk(R.stub.east + .25, 27, R.stub.north, -1172);
    s.surface(R.east + .5, 38, -1122, -940, 'soil', .05);
    walk(36, 40, -1122, -940);
    for (const u of [21.5, 28, 34.5]) row(u, -1122, -940, 9, 1.3, 0, 1.5);
    s.surface(R.east + .5, 23, -940, -566, 'soil', .05);
    walk(23, 30, -940, -566);
    row(20.8, -940, -566, 7, 1.2, 0, .5);
    s.surface(R.east + .5, 23, -537, -60, 'soil', .05);
    walk(23, 29, -537, -60);
    row(20.8, -537, -175, 7.5, 1.15, 0, .5);
    // Farhod ro'parasi: keng trotuar, oq panjara, maydon plitkasi.
    walk(R.east + 1, 26.5, -40, 87, 'pavingDark');
    walk(26.5, 31, -40, 87);
    for (let v = -38; v < 86; v += 2.5) {
      if (v > -24 && v < -14) continue; // bosh kirishga yo'lak
      s.standing(26.6, v, .06, 1.0, .06, 'white');
      s.box(26.6, s.y(26.6, v) + .95, v + 1.25, .06, .06, 2.5, 'white');
      s.box(26.6, s.y(26.6, v) + .5, v + 1.25, .04, .04, 2.5, 'white');
    }
    walk(25, 30, 109, 116);
    walk(25, 30, 116, R.south);
  }

  // --- chiroqlar, girlyandalar, svetoforlar ----------------------------------------

  private lamps(): void {
    const s = this.main, R = XD_ROAD;
    const blocked = (v: number) => XD_CROSSINGS.some(c => Math.abs(c - v) < 5) || XD_JUNCTIONS.some(j => v > j.v0 - 3 && v < j.v1 + 3) ||
      XD_SIDE_ENTRIES.some(e => v > e.v0 - 2 && v < e.v1 + 2);
    for (let v = R.stub.north + 12; v < R.south - 4; v += 36) {
      const at = blocked(v) ? v + 7 : v;
      const west = at > -60 && at < 87 ? R.west - .5 : at < R.north ? R.stub.west - .25 : R.west - .25;
      const east = at > -40 && at < 87 ? R.east + .5 : at < R.north ? R.stub.east + .25 : R.east + .25;
      const palm = at < -900;
      this.lamp(s, west, at, 1, palm);
      this.lamp(s, east, at, -1, palm);
    }
  }

  /**
   * Ko'cha chirog'i. `toward` — yo'l qaysi tomonda (+u yoki −u).
   * Shimolda "palma" (8 yaproqli bezakli bosh), boshqa joyda T-shaklli ikki boshli.
   */
  private lamp(s: Site, u: number, v: number, toward: 1 | -1, palm: boolean): void {
    const y = s.y(u, v), h = palm ? 11 : 10;
    s.cylinder(u, v, y - .05, .5, .32, .36, 'concrete', 10, true);
    s.cylinder(u, v, y + .4, h - .4, .09, .16, palm ? 'metalLight' : 'metal', 8);
    const top = new Vector3(u, y + h, v);
    if (palm) {
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, tip = new Vector3(u + Math.cos(a) * 1.25, y + h + 1.1, v + Math.sin(a) * 1.25);
        s.beam(top, tip, .05, 'metalLight');
        s.add(new BoxGeometry(.9, .06, .3).rotateY(-a).translate(tip.x, tip.y, tip.z), 'lampLens');
      }
    } else {
      for (const dir of [toward, -toward] as const) {
        const end = new Vector3(u + dir * (dir === toward ? 2.2 : 1.2), y + h + .35, v);
        s.beam(new Vector3(u, y + h - .3, v), end, .05, 'metal');
        s.box(end.x, end.y - .08, v, .75, .16, .34, 'metal');
        s.box(end.x, end.y - .18, v, .6, .04, .26, 'lampLens');
      }
    }
    const p = s.world(u + toward * 2.5, v);
    this.lampPoints.push(p);
  }

  private garlands(): void {
    const s = this.main, R = XD_ROAD;
    for (const v of XD_GARLANDS) {
      const u0 = R.west - .25, u1 = R.east + .25;
      const y0 = s.y(u0, v) + 8.6, y1 = s.y(u1, v) + 8.6;
      // Ikki qatlam kabel orasida tik iplar va yulduz-halqa bezaklar (Street View'dagi to'r arka).
      const n = 24;
      const at = (t: number, drop: number) => new Vector3(u0 + (u1 - u0) * t, y0 + (y1 - y0) * t - 1.4 * 4 * t * (1 - t) - drop * (1 - .6 * 4 * t * (1 - t)), v);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        s.beam(at(t0, 0), at(t1, 0), .03, 'garland', 4);
        s.beam(at(t0, 1.6), at(t1, 1.6), .03, 'garland', 4);
        if (i > 0) s.beam(at(t0, 0), at(t0, 1.6), .02, 'garland', 4);
        if (i % 3 === 1) {
          const c = at((t0 + t1) / 2, .8);
          s.add(new OctahedronGeometry(.55, 0).scale(1, 1.3, .2).translate(c.x, c.y, v), 'garland');
          s.add(new TorusGeometry(.7, .035, 4, 16).translate(c.x, c.y, v), 'garland');
        }
      }
      // Girlyanda chiroq ustunlariga osiladi: ustun bo'lmagan joyda o'z ustuni.
      for (const u of [u0, u1]) s.cylinder(u, v, s.y(u, v) + .1, 8.6, .08, .12, 'metal', 8, true);
    }
  }

  private amirTemurSignals(): void {
    const s = this.main, R = XD_ROAD;
    const j = XD_JUNCTIONS[0];
    const posts = [
      { u: R.stub.west - 1.5, v: j.v0 - 2, armTo: 4.5, face: -1 as const, offset: 0 },
      { u: R.east + 2, v: j.v1 + 2, armTo: 8.5, face: 1 as const, offset: 0 },
      { u: R.west - 3, v: j.v1 + 3, armTo: R.west - 3, face: 0 as const, offset: 25 },
      { u: R.stub.east + 2, v: j.v0 - 3, armTo: R.stub.east + 2, face: 0 as const, offset: 25 },
    ];
    for (const p of posts) {
      const y = s.y(p.u, p.v);
      s.cylinder(p.u, p.v, y - .05, 6.6, .12, .16, 'metal', 8, true);
      const top = y + 6.2;
      if (p.armTo !== p.u) s.beam(new Vector3(p.u, top, p.v), new Vector3(p.armTo, top, p.v), .08, 'metal');
      const hu = p.armTo, hv = p.v + (p.face === 0 ? (p.u < 0 ? 1 : -1) * .3 : p.face * .3);
      s.box(hu, top - .75, p.v, .45, 1.25, .35, 'dark');
      (['red', 'amber', 'green'] as const).forEach((colour, i) => {
        const m = new MeshStandardMaterial({ color: 0x141719, roughness: .4 });
        const key = `signal-${p.u.toFixed(1)}-${p.v}-${colour}`;
        this.materials[key] = m;
        this.signalHeads.push({ material: m, colour, offset: p.offset });
        s.add(new SphereGeometry(.13, 10, 6).translate(hu, top - .37 - i * .38, hv), key);
      });
      // Ko'k yo'nalish belgisi — Street View'dagi mast ustida.
      if (p.face !== 0) s.box((p.u + p.armTo) / 2, top + .55, p.v, 2.4, .7, .06, 'signBlue');
    }
  }

  // --- ko'cha jihozlari --------------------------------------------------------------

  private busStops(): void {
    const s = this.main;
    for (const b of XD_BUS_STOPS) {
      const back = b.u + b.side * 1.1, y = s.y(b.u, b.v);
      s.box(back, y + 1.25, b.v, .08, 2.3, 5, 'shelterGlass');
      for (const dv of [-2.5, 2.5]) s.box(b.u + b.side * .2, y + 1.25, b.v + dv, 1.8, 2.3, .08, 'shelterGlass');
      for (const [du, dv] of [[-.8, -2.5], [1.1, -2.5], [-.8, 2.5], [1.1, 2.5]] as const)
        s.box(b.u + b.side * du, y + 1.25, b.v + dv, .1, 2.5, .1, 'metal', true);
      s.box(b.u + b.side * .15, y + 2.55, b.v, 2.4, .14, 5.4, 'metalLight');
      s.box(b.u + b.side * .7, y + .45, b.v, .45, .08, 4, 'metal');
      s.cylinder(b.u - b.side * .9, b.v + 3.2, y, 2.6, .04, .04, 'metal', 6);
      s.box(b.u - b.side * .9, y + 2.5, b.v + 3.2, .06, .6, .6, 'signBlue');
    }
  }

  private billboards(): void {
    const s = this.main;
    const faces = ['billboardA', 'billboardB', 'billboardC'];
    XD_BILLBOARDS.forEach((b, i) => {
      const y = s.y(b.u, b.v);
      for (const du of [-1.8, 1.8]) s.cylinder(b.u + du, b.v, y - .05, 5.2, .14, .16, 'metal', 8, true);
      s.box(b.u, y + 6.6, b.v, 6.4, 3.2, .35, 'dark');
      for (const side of [-1, 1]) s.box(b.u, y + 6.6, b.v + side * .19, 6.0, 2.85, .04, faces[i % 3]!);
    });
  }

  private kiosks(): void {
    const s = this.main;
    // Amir Temur shimolidagi gul bozori va do'konchalar qatori.
    for (const [u, v, d, key] of [[29, -1238, 12, 'kioskTeal'], [29, -1222, 10, 'kioskRed']] as const) {
      s.standing(u, v, 5, 3.2, d, 'white', true);
      s.box(u, s.y(u, v) + 3.25, v, 5.6, .5, d + .4, key);
    }
    // "MARKET" kioski (g'arb, v≈−245) va O'zbekiston ko'chasidan janubdagi pavilon.
    s.standing(-20, -245, 5, 3, 8, 'white', true);
    s.box(-20, s.y(-20, -245) + 3.05, -245, 5.4, .55, 8.4, 'dark');
    s.standing(29.5, -588, 4.5, 3, 9, 'white', true);
    s.box(29.5, s.y(29.5, -588) + 3.05, -588, 4.9, .5, 9.4, 'kioskRed');
  }

  // --- g'arbiy xiyobon ----------------------------------------------------------------

  private boulevard(): void {
    const s = this.main, B = XD_BOULEVARD;
    s.surface(B.uMin, B.uMax, B.vMin, B.vMax, 'paving', .055);
    const period = 19.3;
    // Olti burchakli maysa parterlari: markaziy va chekka yo'laklar, ko'ndalang yo'lak har 19.3 m.
    for (let v0 = B.vMin + 1.25; v0 + period <= B.vMax + .1; v0 += period) {
      const v1 = v0 + period - 2.5, c = 3.6;
      if (B.fountains.some(f => f > v0 - 4 && f < v1 + 4) || (B.oval.v > v0 - 6 && B.oval.v < v1 + 6)) {
        // Favvorali modulda maysa ikki chetga siqiladi.
        for (const [u0, u1] of [[B.uMin + 2.5, B.axis - 6.5], [B.axis + 6.5, B.uMax - 2.5]] as const)
          s.polygon([[u0 + 1.5, v0], [u1 - 1.5, v0], [u1, v0 + 1.5], [u1, v1 - 1.5], [u1 - 1.5, v1], [u0 + 1.5, v1], [u0, v1 - 1.5], [u0, v0 + 1.5]], 'lawn', .07);
        continue;
      }
      for (const [u0, u1] of [[B.uMin + 2.5, B.axis - 2.5], [B.axis + 2.5, B.uMax - 2.5]] as const) {
        s.polygon([[u0 + c, v0], [u1 - c, v0], [u1, v0 + c], [u1, v1 - c], [u1 - c, v1], [u0 + c, v1], [u0, v1 - c], [u0, v0 + c]], 'lawn', .07);
        // Diagonal yo'lak parterni X shaklida kesadi.
        s.line(u0 + 1, v0 + 1, u1 - 1, v1 - 1, 1.6, 'paving', .085);
        s.line(u1 - 1, v0 + 1, u0 + 1, v1 - 1, 1.6, 'paving', .085);
        // Topiar butalar va yosh ignabarglilar.
        const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        for (const [du, dv] of [[-3.2, -4.6], [3.2, 4.6]] as const) {
          const y = s.y(cu + du, cv + dv);
          s.add(new IcosahedronGeometry(.55, 1).scale(1, .85, 1).translate(cu + du, y + .45, cv + dv), 'hedge');
        }
        s.tree(cu + 3.3, cv - 4.4, .42, 3, false);
        s.tree(cu - 3.3, cv + 4.4, .42, 3, false);
      }
    }
    // Cho'zinchoq favvoralar markaziy o'qda.
    for (const f of B.fountains) this.basin(s, B.axis - 2, B.axis + 2, f - 9.5, f + 9.5, true);
    // Oval maydon: g'isht halqa va dumaloq favvora.
    const o = B.oval, ring: Array<readonly [number, number]> = [];
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; ring.push([o.u + Math.cos(a) * o.ru, o.v + Math.sin(a) * o.rv]); }
    s.polygon(ring, 'brick', .075);
    const yo = s.y(o.u, o.v);
    for (let i = 0; i < 24; i++) {
      const a0 = i / 24 * Math.PI * 2, a1 = (i + 1) / 24 * Math.PI * 2;
      s.beam(new Vector3(o.u + Math.cos(a0) * 4, yo + .35, o.v + Math.sin(a0) * 4), new Vector3(o.u + Math.cos(a1) * 4, yo + .35, o.v + Math.sin(a1) * 4), .22, 'granite');
    }
    const disc: Array<readonly [number, number]> = [];
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; disc.push([o.u + Math.cos(a) * 3.8, o.v + Math.sin(a) * 3.8]); }
    s.polygon(disc, 'water', .3);
    s.cylinder(o.u, o.v, yo, 1.4, .5, .8, 'granite', 12, true);
    this.nozzles.push({ u: o.u, v: o.v, y: yo + 1.4, reach: 0 });
    this.map.water.push(new Float32Array(disc.flatMap(([u, v]) => { const p = s.world(u, v); return [p.x, p.z]; })));
    // Xiyobon chekkalarida keng bargli daraxtlar.
    // Street View: xiyobonda asosan yosh daraxtlar va butalar, faqat g'arbiy chetda o'rta daraxtlar.
    for (let v0 = B.vMin + 1.25, i = 0; v0 + period <= B.vMax + .1; v0 += period, i++) {
      s.tree(B.uMin + 1.2, v0 + 9.6, .85, 0);
      if (i % 2 === 0) s.tree(B.uMax - 1.4, v0 + 9.6, .55, 0);
    }
  }

  /** Granit bortli favvora havzasi; `jets` bo'lsa ikki qator og'iz. */
  private basin(s: Site, u0: number, u1: number, v0: number, v1: number, jets: boolean): void {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, y = s.y(cu, cv), w = u1 - u0, d = v1 - v0, h = .5;
    for (const [bu, bv, bw, bd] of [[cu, v0 + .2, w, .4], [cu, v1 - .2, w, .4], [u0 + .2, cv, .4, d], [u1 - .2, cv, .4, d]] as const)
      s.box(bu, y + h / 2, bv, bw, h, bd, 'granite', true);
    s.surface(u0 + .4, u1 - .4, v0 + .4, v1 - .4, 'water', .32);
    const ring = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => s.world(u!, v!));
    this.map.water.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
    if (!jets) return;
    for (let v = v0 + 2; v < v1 - 1.5; v += 3) for (const side of [-1, 1]) {
      this.nozzles.push({ u: cu + side * (w / 2 - .8), v, y: y + .35, reach: -side * (w / 2 - .8) });
    }
  }

  private boulevardFurniture(): Group {
    const B = XD_BOULEVARD, points: Array<{ x: number; z: number; yaw: number }> = [];
    const yaw = this.main.group.rotation.y;
    for (let v = B.vMin + 10; v < B.vMax - 6; v += 19.3) for (const u of [B.axis - 3.4, B.axis + 3.4]) {
      if (B.fountains.some(f => Math.abs(f - v) < 11) || Math.abs(B.oval.v - v) < 16) continue;
      const p = this.basis.point(u, v);
      points.push({ x: p.x, z: p.z, yaw: yaw + (u < B.axis ? Math.PI / 2 : -Math.PI / 2) });
    }
    return buildParkFurniture(points, this.ground);
  }

  // --- landmarklar ------------------------------------------------------------------

  /** Poydevori relyefning eng past burchagidan boshlanadigan bino hajmi. */
  private mass(s: Site, r: { uMin: number; uMax: number; vMin: number; vMax: number }, height: number, key: string, footprint = true): { lo: number; top: number } {
    const lo = Math.min(s.y(r.uMin, r.vMin), s.y(r.uMax, r.vMin), s.y(r.uMin, r.vMax), s.y(r.uMax, r.vMax)) - .3;
    const top = s.y((r.uMin + r.uMax) / 2, (r.vMin + r.vMax) / 2) + height;
    s.box((r.uMin + r.uMax) / 2, (lo + top) / 2, (r.vMin + r.vMax) / 2, r.uMax - r.uMin, top - lo, r.vMax - r.vMin, key, true);
    if (footprint) {
      const ring = [[r.uMin, r.vMin], [r.uMax, r.vMin], [r.uMax, r.vMax], [r.uMin, r.vMax]].map(([u, v]) => s.world(u!, v!));
      this.map.buildings.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
    }
    return { lo, top };
  }

  /** Sharqqa (+u) yoki g'arbga qaragan fasaddagi bitmap yozuv. `face` = +1 — sharqiy fasad. */
  private text(s: Site, text: string, u: number, face: 1 | -1, vCenter: number, yBottom: number, cell: number, key: string): void {
    const step = cell * 6, width = text.length * step - cell;
    text.split('').forEach((ch, index) => {
      const rows = GLYPHS[ch];
      if (!rows) return;
      rows.forEach((row, r) => row.split('').forEach((c, col) => {
        if (c !== '#') return;
        // Sharqiy fasadga qaragan kuzatuvchi −u ga boqadi: uning o'ngi −v.
        const along = index * step + col * cell + cell / 2 - width / 2;
        const v = vCenter - face * along;
        s.box(u + face * .12, yBottom + (6.5 - r) * cell, v, .16, cell * .92, cell * .92, key);
      }));
    });
  }

  private mall(): void {
    const s = this.main, M = XD_MALL;
    s.surface(M.forecourt.uMin, M.forecourt.uMax, M.forecourt.vMin, M.forecourt.vMax, 'paving', .055);
    for (const c of M.carpets) {
      s.surface(c.uMin, c.uMax, c.vMin, c.vMax, 'brick', .07);
      for (let v = c.vMin + 1; v < c.vMax; v += 4) s.surface(c.uMin + 1, c.uMax - 1, v, v + .4, 'paving', .08);
    }
    const north = this.mass(s, M.north, M.north.height, 'mallWall');
    const south = this.mass(s, M.south, M.south.height, 'mallWall');
    this.mass(s, M.tail, M.tail.height, 'mallWall');
    this.mass(s, M.annex, M.annex.height, 'mallBand');
    this.mass(s, M.side, M.side.height, 'concrete');
    // Sharqiy fasad: pastda vitraj, tepada och band va jigarrang karniz — Street View.
    for (const [block, top] of [[M.north, north.top], [M.south, south.top]] as const) {
      const cv = (block.vMin + block.vMax) / 2, d = block.vMax - block.vMin - 2, y0 = s.y(block.uMax, cv);
      s.box(block.uMax + .08, y0 + 2.1, cv, .16, 3.4, d, 'mallGlass');
      s.box(block.uMax + .25, top - .45, cv, .5, .9, d + 2, 'mallBand');
      for (let v = block.vMin + 3; v < block.vMax - 2; v += 6) s.box(block.uMax + .2, y0 + 2.1, v, .35, 3.6, .35, 'mallWall');
      // Kirish soyabonlari.
      s.box(block.uMax + 2.2, y0 + 4.1, cv, 4.4, .25, 10, 'mallBand');
    }
    this.text(s, 'ISHONCH', M.south.uMax + .3, 1, -742, s.y(M.south.uMax, -742) + 5.1, .38, 'green');
    s.box(M.south.uMax + .35, s.y(M.south.uMax, -760) + 6.1, -760, .2, 1.6, 2.6, 'red');
    // Rotunda: baland baraban, vertikal qovurg'alar, qizg'ish band va past gumbaz.
    const R = M.rotunda, yr = s.y(R.u, R.v);
    s.cylinder(R.u, R.v, north.lo, yr + R.height - north.lo, R.r, R.r, 'rotunda', 40, true);
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2;
      if (Math.cos(a) < -.35) continue;
      s.box(R.u + Math.cos(a) * (R.r + .12), yr + R.height / 2 + 2, R.v + Math.sin(a) * (R.r + .12), .35, R.height - 4, .35, 'white', false, -a);
    }
    s.add(new CylinderGeometry(R.r + .35, R.r + .35, 1.4, 40).translate(R.u, yr + R.height - 1.6, R.v), 'mallBand');
    s.add(new SphereGeometry(R.r * .96, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, .16, 1).translate(R.u, yr + R.height, R.v), 'dome');
    this.text(s, 'BONUM', R.u + R.r + .25, 1, R.v, yr + R.height - 1.35, .3, 'white');
  }

  private hotel(): void {
    const s = this.main, H = XD_HOTEL;
    const slab = this.mass(s, H.slab, H.slab.height, 'hotelWall');
    this.mass(s, H.tower, H.tower.height, 'hotelWall', false);
    for (const p of H.podium) this.mass(s, p, p.height, 'concrete');
    // Qavat bo'yicha deraza lentalari uzun fasadlarda.
    const cu = (H.slab.uMin + H.slab.uMax) / 2, w = H.slab.uMax - H.slab.uMin - 1.5, base = s.y(cu, (H.slab.vMin + H.slab.vMax) / 2);
    for (let f = 1; f < 7; f++) for (const v of [H.slab.vMin - .06, H.slab.vMax + .06]) {
      s.box(cu, base + 3.4 * f + 1.3, v, w, 1.5, .1, 'hotelWindow');
    }
    this.text(s, 'NAVOIY', H.slab.uMax + .1, 1, (H.slab.vMin + H.slab.vMax) / 2, slab.top - 3.2, .38, 'signBlue');
  }

  private sportSaroyi(): void {
    const s = this.main, S = XD_SPORT;
    s.surface(S.forecourt.uMin, S.forecourt.uMax, S.forecourt.vMin, S.forecourt.vMax, 'paving', .055);
    const H = S.hall, cv = (H.vMin + H.vMax) / 2, d = H.vMax - H.vMin;
    const lo = Math.min(s.y(H.uMin, H.vMin), s.y(H.uMax, H.vMax), s.y(H.uMin, H.vMax), s.y(H.uMax, H.vMin)) - .3;
    const ground = s.y(H.uMax, cv), top = ground + H.height;
    // Pastki qavat ichkariga tortilgan: vitraj 3 m ichkarida, ustida og'ir band.
    s.box((H.uMin + H.uMax - 3) / 2, (lo + ground + 7) / 2, cv, H.uMax - H.uMin - 3, ground + 7 - lo, d, 'sportTrim', true);
    s.box(H.uMax - 3.05, ground + 3.6, cv, .12, 6.2, d - 2, 'sportGlass');
    s.box((H.uMin + H.uMax) / 2, ground + 7 + (H.height - 7) / 2, cv, H.uMax - H.uMin, H.height - 7, d, 'sportBand', true);
    s.box(H.uMax + .06, ground + 7.3, cv, .14, .5, d, 'sportTrim');
    s.box(H.uMax + .06, top - .35, cv, .14, .4, d, 'sportTrim');
    // Tom: sun'iy yo'ldoshda och kulrang, chetida past parapet.
    s.box((H.uMin + H.uMax) / 2, top + .05, cv, H.uMax - H.uMin - .4, .1, d - .4, 'concrete');
    for (let v = H.vMin + 2; v <= H.vMax - 2; v += 6) s.cylinder(H.uMax - .9, v, ground, 7, .32, .32, 'white', 12, true);
    for (let i = 0; i < 6; i++) { const h = (6 - i) * .15; s.box(H.uMax + .4 + i * .45, ground + h / 2 - .1, cv, .45, h, 40, 'stone', true); }
    this.mass(s, S.annex, S.annex.height, 'sportTrim', false);
    // Banerlar va yozuv: "SPORT SAROYI" o'rtada, olimpiya halqalari shimoliy uchida.
    for (const [v, key] of [[12, 'bannerA'], [30, 'bannerB'], [46, 'bannerC']] as const) s.box(H.uMax + .1, ground + 9.2, v, .08, 2.6, 9, key);
    this.text(s, 'SPORT SAROYI', H.uMax + .08, 1, 30, top - 3.1, .3, 'white');
    const ringY = top - 2.3;
    for (const [dv, dy, key] of [[-2.2, .5, 'ringBlue'], [0, .5, 'ringBlack'], [2.2, .5, 'ringRed'], [-1.1, -.25, 'ringYellow'], [1.1, -.25, 'ringGreen']] as const) {
      s.add(new TorusGeometry(.85, .08, 8, 24).rotateY(Math.PI / 2).translate(H.uMax + .22, ringY + dy, 2 - dv), key);
    }
    const ring = [[H.uMin, H.vMin], [H.uMax, H.vMin], [H.uMax, H.vMax], [H.uMin, H.vMax]].map(([u, v]) => s.world(u!, v!));
    this.map.buildings.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
    // Shimoldagi oq "kapsula" bino (sun'iy yo'ldoshda yumaloq uchli).
    const C = S.capsule, cu = (C.uMin + C.uMax) / 2, r = (C.uMax - C.uMin) / 2, yc = s.y(cu, (C.vMin + C.vMax) / 2);
    this.mass(s, { uMin: C.uMin, uMax: C.uMax, vMin: C.vMin + r, vMax: C.vMax - r }, C.height, 'white');
    for (const v of [C.vMin + r, C.vMax - r]) s.cylinder(cu, v, yc - .3, C.height + .3, r, r, 'white', 24, true);
    // Old maydon: ignabargli qatorlar, bayroqlar, "I ♥ NAVOIY".
    for (const [v0, v1] of [[-56, -12], [6, 60]] as const) {
      s.surface(-26, -18, v0, v1, 'lawn', .07);
      for (let v = v0 + 2.5, i = 0; v < v1; v += 5, i++) s.tree(-22, v, i % 2 ? .5 : .62, i % 3 === 0 ? 0 : 3);
    }
    for (const v of S.flags) {
      const y = s.y(-32, v);
      s.cylinder(-32, v, y, 12, .06, .1, 'metalLight', 8, true);
      s.box(-32, y + 11.2, v + 1.2, .02, 1.3, 2.4, v === S.flags[0] ? 'bannerA' : v === S.flags[1] ? 'white' : 'bannerC');
    }
    s.surface(-40, -14, 66, 84, 'lawn', .07);
    for (let u = -38; u < -16; u += 3) s.add(new IcosahedronGeometry(.45, 1).scale(1, .7, 1).translate(u, s.y(u, 70) + .3, 70), 'red');
    const yh = s.y(-27, 78);
    this.text(s, 'I', -27, 1, 84, yh + .1, .16, 'white');
    s.add(new SphereGeometry(.35, 10, 8).translate(-27.1, yh + .85, 82.6), 'red');
    s.add(new SphereGeometry(.35, 10, 8).translate(-27.1, yh + .85, 82.0), 'red');
    s.add(new OctahedronGeometry(.5, 0).scale(.4, 1, 1).translate(-27.1, yh + .5, 82.3), 'red');
    this.text(s, 'NAVOIY', -27, 1, 78.3, yh + .1, .16, 'white');
  }

  private pool(): void {
    const s = this.main, P = XD_POOL;
    s.surface(P.deck.uMin, P.deck.uMax, P.deck.vMin, P.deck.vMax, 'paving', .06);
    for (const pool of [P.main, P.small]) {
      const cu = (pool.uMin + pool.uMax) / 2, cv = (pool.vMin + pool.vMax) / 2, y = s.y(cu, cv);
      for (const [bu, bv, bw, bd] of [[cu, pool.vMin, pool.uMax - pool.uMin + .6, .3], [cu, pool.vMax, pool.uMax - pool.uMin + .6, .3],
        [pool.uMin, cv, .3, pool.vMax - pool.vMin], [pool.uMax, cv, .3, pool.vMax - pool.vMin]] as const)
        s.box(bu, y + .12, bv, bw, .24, bd, 'white', true);
      s.surface(pool.uMin + .15, pool.uMax - .15, pool.vMin + .15, pool.vMax - .15, 'poolWater', .08);
      const ring = [[pool.uMin, pool.vMin], [pool.uMax, pool.vMin], [pool.uMax, pool.vMax], [pool.uMin, pool.vMax]].map(([u, v]) => s.world(u!, v!));
      this.map.water.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
    }
    const y = s.y(-49.5, -360);
    for (let i = 1; i < 8; i++) {
      const u = P.main.uMin + i * (P.main.uMax - P.main.uMin) / 8;
      s.beam(new Vector3(u, y + .12, P.main.vMin + .5), new Vector3(u, y + .12, P.main.vMax - .5), .05, i % 2 ? 'red' : 'white', 4);
    }
  }

  private memorial(): void {
    const s = this.main, M = XD_MEMORIAL;
    s.surface(M.plaza.uMin, M.plaza.uMax, M.plaza.vMin, M.plaza.vMax, 'paving', .06);
    s.surface(M.lawn.uMin, M.lawn.uMax, M.lawn.vMin, M.lawn.vMax, 'lawn', .075);
    for (const [u, v] of M.blocks) {
      s.standing(u, v, 2.6, .6, 2.6, 'granite', true);
      s.box(u, s.y(u, v) + .62, v, 2.2, .08, 2.2, 'stone');
      s.add(new IcosahedronGeometry(.45, 1).scale(1, .6, 1).translate(u, s.y(u, v) + .8, v), 'red');
    }
    // Yodgorlik: pog'onali poydevor va bronza haykal.
    const { u, v } = M.statue, y = s.y(u, v);
    for (let i = 0; i < 3; i++) s.box(u, y + .2 + i * .4, v, 5 - i * 1.1, .4, 5 - i * 1.1, 'granite', true);
    s.box(u, y + 2.6, v, 1.6, 2.4, 1.6, 'stone', true);
    s.cylinder(u, v, y + 3.8, 2.8, .38, .55, 'bronze', 10);
    s.add(new SphereGeometry(.34, 10, 8).translate(u, y + 6.9, v), 'bronze');
    // Gulzor: tuproq, halqa bo'ylab archalar.
    const F = M.flowers, fu = (F.uMin + F.uMax) / 2, fv = (F.vMin + F.vMax) / 2;
    s.surface(F.uMin, F.uMax, F.vMin, F.vMax, 'soil', .075);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; s.tree(fu + Math.cos(a) * 3.2, fv + Math.sin(a) * 3.2, .4, 3, false); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; s.tree(fu + Math.cos(a) * 12.5, fv + Math.sin(a) * 12.5, .55, 3); }
    // Juft to'rtburchak klumbalar daraxtlar bilan.
    for (const [v0, v1] of M.planters) for (const [u0, u1] of [[73, 81], [84, 92]] as const) {
      s.standing((u0 + u1) / 2, (v0 + v1) / 2, u1 - u0, .35, v1 - v0, 'granite', true);
      s.surface(u0 + .3, u1 - .3, v0 + .3, v1 - .3, 'lawn', .4);
      for (let tv = v0 + 3; tv < v1 - 1; tv += 6) s.tree((u0 + u1) / 2, tv, .9, 0);
    }
    // Ko'cha bo'yidagi archalar qatori va sharqiy chekkadagi daraxtlar.
    for (let tv = M.plaza.vMin + 3; tv < M.plaza.vMax; tv += 6) s.tree(31, tv, .8, 3);
    for (let tv = M.plaza.vMin + 4; tv < M.plaza.vMax; tv += 8) s.tree(97, tv, 1.2, 0);
  }

  // --- janubi-sharqiy tarmoq ---------------------------------------------------------

  private southEastArm(): void {
    const s = this.armSite;
    const road = { west: .8, medianWest: 7, medianEast: 8, east: 15.8, v0: 20, v1: 470 };
    const crossings = [226];
    s.surface(road.west, road.east, road.v0, road.v1, 'asphalt', .03);
    const gaps = crossings.map(v => [v - 2.2, v + 2.2] as const);
    for (const [a, b] of Site.spans(road.v0, road.v1, gaps)) s.run(7.5, 1, .2, a, b, 'curb', true);
    const bay: Span = [240, 285];
    for (const [a, b] of Site.spans(road.v0, road.v1, [[150, 158]])) s.run(road.west - .25, .5, .18, a, b, 'curb', true);
    for (const [a, b] of Site.spans(road.v0, road.v1, [bay, [150, 158], [336, 344]])) s.run(road.east + .25, .5, .18, a, b, 'curb', true);
    s.surface(road.east, 19, bay[0] + 5, bay[1] - 5, 'asphaltBay', .035);
    s.polygon([[road.east, bay[0]], [19, bay[0] + 5], [road.east, bay[0] + 5]], 'asphaltBay', .035);
    s.polygon([[road.east, bay[1]], [road.east, bay[1] - 5], [19, bay[1] - 5]], 'asphaltBay', .035);
    s.run(19.25, .5, .18, bay[0] + 5, bay[1] - 5, 'curb', true);
    for (const [a, b] of Site.spans(road.v0, road.v1, gaps)) {
      s.surface(road.medianWest - .38, road.medianWest - .23, a, b, 'markingYellow', .07);
      s.surface(road.medianEast + .23, road.medianEast + .38, a, b, 'markingYellow', .07);
      s.surface(road.west + .3, road.west + .45, a, b, 'marking', .07);
      s.surface(road.east - .45, road.east - .3, a, b, 'marking', .07);
      for (let v = a + 2; v + 3 < b - 1; v += 9) for (const u of [3.9, 11.9]) s.surface(u - .07, u + .07, v, v + 3, 'marking', .07);
    }
    for (const v of crossings) for (let u = road.west + .6; u < road.east - .5; u += 1) {
      if (u > road.medianWest - .3 && u < road.medianEast + .3) continue;
      s.surface(u, u + .5, v - 2, v + 2, 'marking', .075);
    }
    // Ikki tomonda keng daraxt tasmalari (Street View: qalin soya, oqlangan tanalar).
    s.surface(-15, road.west - .5, road.v0, road.v1, 'lawn', .05);
    s.surface(-17, -15, road.v0, road.v1, 'paving', .06);
    s.surface(road.east + .5, 28, road.v0, road.v1, 'lawn', .05);
    s.surface(28, 31, road.v0, road.v1, 'paving', .06);
    for (let v = road.v0 + 4, i = 0; v < road.v1; v += 8, i++) {
      if (Math.abs(v - 226) < 4 || (v > 148 && v < 160)) continue;
      s.tree(-5, v, 1.35, i % 3 === 0 ? 2 : 0);
      s.tree(-11.5, v + 4, 1.25, 0);
      if (!(v > bay[0] - 2 && v < bay[1] + 2)) s.tree(21, v + 2, 1.3, 0);
      s.tree(25.5, v + 6, 1.2, i % 4 === 1 ? 2 : 0);
    }
    for (let v = road.v0 + 16; v < road.v1; v += 34) {
      if (Math.abs(v - 226) < 5) continue;
      this.lamp(s, road.west - .25, v, 1, false);
      this.lamp(s, road.east + .25, v + 17, -1, false);
    }
    const y = s.y(20.5, 262);
    s.box(21.6, y + 1.25, 262, .08, 2.3, 5, 'shelterGlass');
    s.box(20.9, y + 2.55, 262, 2.4, .14, 5.4, 'metalLight');
  }

  // --- kadr ----------------------------------------------------------------------

  update(dt: number, night: number): void {
    this.time = (this.time + Math.min(dt, .1)) % 10000;
    for (const m of this.lens) m.emissiveIntensity = .15 + night * 2.6;
    for (const head of this.signalHeads) {
      const phase = ((this.time + head.offset) % 50 + 50) % 50;
      const current = phase < 20 ? 'green' : phase < 23 ? 'amber' : 'red';
      const on = current === head.colour;
      head.material.emissive.setHex(on ? ({ red: 0xff2a1a, amber: 0xffa512, green: 0x22ee66 })[head.colour] : 0x000000);
      head.material.emissiveIntensity = on ? 2.2 : 0;
    }
    const p = this.jets.geometry.getAttribute('position');
    if (!this.nozzles.length) return;
    for (let i = 0; i < p.count; i++) {
      const n = this.nozzles[i % this.nozzles.length]!;
      const t = (this.time * .6 + i * .61803398875) % 1;
      if (n.reach === 0) {
        const a = i * 2.39996, r = .1 + t * .8;
        p.setXYZ(i, n.u + Math.cos(a) * r, n.y + .3 + Math.sin(t * Math.PI) * 4.5, n.v + Math.sin(a) * r);
      } else {
        p.setXYZ(i, n.u + n.reach * t, n.y + .3 + Math.sin(t * Math.PI) * 1.6, n.v + (i % 3 - 1) * .1);
      }
    }
    p.needsUpdate = true;
  }

  dispose(): void {
    if (this.trees) {
      for (const m of this.trees.meshes) m.removeFromParent();
      disposeTrees(this.trees);
      this.trees = null;
    }
    for (const g of this.extras) { g.removeFromParent(); disposeCityDetails(g); }
    this.group.traverse(n => { if (n instanceof Mesh || n instanceof Points) n.geometry.dispose(); });
    for (const m of Object.values(this.materials)) m.dispose();
    this.jets.material.dispose();
    this.group.clear();
  }
}
