import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Points, PointsMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import type { CityMapData } from './CityTile.ts';
import { Physics, RAPIER } from './Physics.ts';
import {
  FARXOD_BASIN, FARXOD_CANOPY, FARXOD_COURTYARD, FARXOD_FOOTPRINT, FARXOD_HEIGHT, FARXOD_POOLS, farxodBasis,
} from './FarxodReference.ts';
import { assetTrees } from './TreeAssets.ts';
import { disposeTrees, type TreeMeshes } from './trees.ts';
import { buildParkFurniture, disposeCityDetails } from './CityDetails.ts';
import { parkPavingTexture } from './SurfaceMaterials.ts';

/** Ayvon chuqurligi va balandligi — fotosuratdagi ustunlar qatoridan. */
const ARCADE_DEPTH = 3.6, ARCADE_HEIGHT = 7.2;

/** Tomdagi "ФАРХОД" uchun 5x7 bitmap. Shrift yuklamaydi, harflar qutichalardan. */
const GLYPHS: Record<string, string[]> = {
  'Ф': ['..#..', '#####', '#.#.#', '#.#.#', '#####', '..#..', '..#..'],
  'А': ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  'Р': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Х': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'О': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'Д': ['..###', '..#.#', '.##.#', '.#..#', '##..#', '#####', '#...#'],
};

/**
 * "Farhod" madaniyat markazi va uning maydoni.
 *
 * Poydevor, ichki hovli va favvoralar o'lchangan (`FarxodReference`); fasad
 * fotosuratdan: pastda ustunli ayvon, tepada tekis terrakota qoplama,
 * shimoliy qanotda tik oq qovurg'alar, tomda "ФАРХОД" yozuvi va janubiy
 * uchida yarim doira shishali tom. Bezak o'lchamlari — muallif bahosi.
 *
 * Shoh ko'cha, Sport Saroyi va atrofdagi majmualar bu yerda EMAS:
 * 2026-09-13 tekshiruvida ular sun'iy yo'ldoshga nisbatan 20–70 m siljigan
 * chiqdi, shuning uchun `XalqlarDostligi` moduliga o'lchab qayta qurildi.
 */
export class Farxod {
  readonly group = new Group();
  readonly map: CityMapData = { buildings: [], roads: [], water: [], areas: [] };
  readonly basis: ReturnType<typeof farxodBasis>;
  readonly base: number;
  readonly height = FARXOD_HEIGHT;
  private readonly body: RAPIER.RigidBody;
  private readonly parts = new Map<string, BufferGeometry[]>();
  private readonly materials: Record<string, MeshStandardMaterial>;
  private trees: TreeMeshes | null = null;
  private readonly furniture: Group;
  private readonly jets: Points<BufferGeometry, PointsMaterial>;
  private readonly glow: MeshStandardMaterial[] = [];
  private time = 0;
  /** Favvora og'izlari: `reach` 0 bo'lsa tik otiladi, aks holda yoy chizadi. */
  private readonly nozzles: Array<{ u: number; v: number; y: number; reach: number }> = [];

  constructor(frame: CityFrame, private ground: Ground, private physics: Physics) {
    this.basis = farxodBasis(frame);
    this.base = ground.heightAt(this.basis.origin.x, this.basis.origin.z);
    this.group.name = 'Farhod madaniyat markazi · satellite + photo reference';
    this.group.position.set(this.basis.origin.x, this.base, this.basis.origin.z);
    this.group.rotation.y = Math.atan2(-this.basis.east.z, this.basis.east.x);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.group.position.x, this.base, this.group.position.z).setRotation(this.group.quaternion));

    const material = (color: number, roughness = .86, metalness = 0) => new MeshStandardMaterial({ color, roughness, metalness });
    this.materials = {
      stone: material(0xb06a4c), course: material(0x90543c), plinth: material(0x9a8f7e, .72),
      grey: material(0xcfcabc, .92), brown: material(0x53372a, .8), white: material(0xf1eee4, .78),
      glass: material(0x22383c, .18, .42), metal: material(0x6b7276, .45, .6),
      bronze: material(0x6b5230, .46, .55), granite: material(0x7d736a, .6), vault: material(0xb9c0c2, .35, .55),
      paving: material(0xc9c3b4), stripe: material(0x9d7256), water: material(0x2e6f78, .17, .2),
    };
    // Har bir yassi qatlam O'ZINING chuqurlik siljishida: plitka ustida tasma,
    // uning ustida suv.
    for (const [key, factor] of [['paving', -12], ['stripe', -13], ['water', -14]] as const) {
      const m = this.materials[key]!;
      m.polygonOffset = true; m.polygonOffsetFactor = factor;
      m.polygonOffsetUnits = factor * 3; m.side = DoubleSide;
      if (key === 'paving' || key === 'stripe') m.map = parkPavingTexture();
    }
    for (const key of ['glass', 'white']) { const m = this.materials[key]!; m.emissive.setHex(key === 'glass' ? 0x3f6b63 : 0xb9c6cc); this.glow.push(m); }

    this.massing();
    this.westFacade();
    this.roofVault();
    this.roofSign();
    this.plaza();
    const treePoints = this.planting();

    for (const [key, parts] of this.parts) {
      const geometry = mergeGeometries(parts)!; for (const g of parts) g.dispose();
      const mesh = new Mesh(geometry, this.materials[key]);
      mesh.name = `Farxod · ${key}`;
      mesh.castShadow = !['paving', 'stripe', 'water'].includes(key);
      mesh.receiveShadow = true; this.group.add(mesh);
    }
    this.parts.clear();

    // Daraxt va jihoz assetlari dunyo koordinatasida keladi — ularni guruhning
    // burilishini bekor qiluvchi tugun ostiga qo'yamiz (Hokimiyatdagi kabi).
    const world = new Group(); world.name = 'Farxod · world-space landscaping';
    world.position.copy(this.group.position).negate().applyQuaternion(this.group.quaternion.clone().invert());
    world.quaternion.copy(this.group.quaternion).invert(); this.group.add(world);
    const meshes = assetTrees(treePoints, (x, z) => ground.heightAt(x, z));
    if (meshes) { for (const lod of meshes) if (lod.levels[1]) lod.levels[1].distance = 600; this.trees = { meshes, count: treePoints.length, sharedAssets: true }; world.add(...meshes); }

    // Maydon ichidagi chiroqlar. Shoh ko'cha trotuaridagilar `XalqlarDostligi` da.
    const lamps: Array<{ x: number; z: number; yaw: number }> = [];
    for (let v = -52; v < 54; v += 12) for (const u of [-9, -46]) {
      const p = this.basis.point(u, v); lamps.push({ x: p.x, z: p.z, yaw: this.group.rotation.y });
    }
    this.furniture = buildParkFurniture(lamps, ground); world.add(this.furniture);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(600 * 3), 3));
    this.jets = new Points(geometry, new PointsMaterial({ color: 0xd6f1f2, size: .13, transparent: true, opacity: .55, depthWrite: false }));
    this.jets.name = 'Farxod · fountain spray'; this.jets.frustumCulled = false;
    this.group.add(this.jets); this.update(0, 0);

    this.group.userData = {
      place: 'Farhod madaniyat markazi, Navoiy',
      footprint: 'Bing/ESRI satellite + Google Street View 360 reference',
      bearing: 159, nozzles: this.nozzles.length, trees: treePoints.length,
      dimensions: 'measured plan, photo-estimated heights',
    };
  }

  // --- yordamchilar (Hokimiyat bilan bir xil shakl) ------------------------

  private y(u: number, v: number) { const p = this.basis.point(u, v); return this.ground.heightAt(p.x, p.z) - this.base; }

  private add(g: BufferGeometry, key: string) {
    const flat = g.index ? g.toNonIndexed() : g.clone(); g.dispose();
    const p = flat.getAttribute('position'), uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * .25; uv[i * 2 + 1] = p.getZ(i) * .25; }
    flat.setAttribute('uv', new BufferAttribute(uv, 2));
    const bucket = this.parts.get(key) ?? []; bucket.push(flat); this.parts.set(key, bucket);
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, key: string, collision = false) {
    this.add(new BoxGeometry(w, h, d).translate(x, y, z), key);
    if (collision) this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z), this.body);
  }

  private beam(a: Vector3, b: Vector3, r: number, key: string) {
    const delta = b.clone().sub(a), length = delta.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    const p = a.clone().add(b).multiplyScalar(.5);
    this.add(new CylinderGeometry(r, r, length, 6).applyQuaternion(q).translate(p.x, p.y, p.z), key);
  }

  /** Relyefga yopishgan to'rtburchak yuza — plitka va suv shundan. */
  private rect(u: number, v: number, w: number, d: number, key: string, lift = .045) {
    const nx = Math.max(1, Math.ceil(w / 3)), nz = Math.max(1, Math.ceil(d / 3)), positions: number[] = [];
    const at = (s: number, t: number) => { const a = u - w / 2 + w * s, b = v - d / 2 + d * t; return [a, this.y(a, b) + lift, b]; };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
      for (const [s, t] of [[i / nx, j / nz], [i / nx, (j + 1) / nz], [(i + 1) / nx, (j + 1) / nz], [i / nx, j / nz], [(i + 1) / nx, (j + 1) / nz], [(i + 1) / nx, j / nz]])
        positions.push(...at(s!, t!));
    const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.computeVertexNormals(); this.add(g, key);
  }

  /**
   * Qavatli hajm: devor + collider. Poydevor relyefning eng past burchagidan
   * boshlanadi, aks holda bino qiyalikda uchib qoladi.
   */
  private mass(uMin: number, uMax: number, vMin: number, vMax: number, top: number, key = 'stone', from?: number) {
    const lo = from ?? Math.min(...[[uMin, vMin], [uMax, vMin], [uMax, vMax], [uMin, vMax]].map(([u, v]) => this.y(u!, v!))) - .4;
    const w = uMax - uMin, d = vMax - vMin, cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2;
    this.box(cu, (lo + top) / 2, cv, w, top - lo, d, key, true);
    return { lo, top, cu, cv, w, d };
  }

  /** Tom plitasi va chetidagi och kulrang parapet — fotosuratdagi kabi. */
  private parapet(m: { top: number; cu: number; cv: number; w: number; d: number }) {
    this.box(m.cu, m.top + .13, m.cv, m.w - .2, .26, m.d - .2, 'grey');
    this.box(m.cu, m.top + .5, m.cv - m.d / 2 + .45, m.w, .9, .9, 'grey');
    this.box(m.cu, m.top + .5, m.cv + m.d / 2 - .45, m.w, .9, .9, 'grey');
    this.box(m.cu - m.w / 2 + .45, m.top + .5, m.cv, .9, .9, m.d, 'grey');
    this.box(m.cu + m.w / 2 - .45, m.top + .5, m.cv, .9, .9, m.d, 'grey');
  }

  // --- hajmlar ------------------------------------------------------------

  private massing() {
    const { uMin, uMax, vMin, vMax } = FARXOD_FOOTPRINT, c = FARXOD_COURTYARD;
    // Poydevor: butun kontur bo'ylab past cokol, maydondan bir qadam baland.
    this.mass(uMin - 1.2, uMax + 1.2, vMin - 1.2, vMax + 1.2, .55, 'plinth');
    // NIMA UCHUN IKKI QAVAT: fotosuratda pastki qavat ichkariga tortilgan va
    // og'ir yuqori hajm ustunlar ustida osilib turadi. Shuning uchun g'arbiy
    // devor ayvon balandligigacha ARCADE_DEPTH ichkarida tugaydi.
    for (const b of [{ a: vMin, z: -36, top: 11.2 }, { a: -36, z: c.vMin, top: this.height }]) {
      this.mass(uMin + ARCADE_DEPTH, uMax, b.a, b.z, ARCADE_HEIGHT);
      this.parapet(this.mass(uMin, uMax, b.a, b.z, b.top, 'stone', ARCADE_HEIGHT));
    }
    // Janubiy qanot ichki hovlini o'rab turadi — to'rtta yo'g'on bo'lak.
    const wing = 13.6;
    this.mass(uMin + ARCADE_DEPTH, c.uMin, c.vMin, vMax, ARCADE_HEIGHT);
    this.parapet(this.mass(uMin, c.uMin, c.vMin, vMax, wing, 'stone', ARCADE_HEIGHT));
    for (const [a, b, d, e] of [[c.uMax, uMax, c.vMin, vMax], [c.uMin, c.uMax, c.vMin, c.vMin + 3],
      [c.uMin, c.uMax, c.vMax, vMax]] as const) this.parapet(this.mass(a, b, d, e, wing));
    this.rect((c.uMin + c.uMax) / 2, (c.vMin + c.vMax) / 2, c.uMax - c.uMin - 1, c.vMax - c.vMin - 1, 'paving');
    // Tom ustidagi qurilmalar — uzoqdan siluetni jonlantiradi.
    for (const [u, v, h] of [[18, -42, 2.2], [34, -20, 2.6], [12, 4, 1.8], [46, -30, 2.4]] as const)
      this.box(u, (v < -36 ? 11.2 : this.height) + h / 2, v, 4.4, h, 3.2, 'grey');

    const ring = [[uMin, vMin], [uMax, vMin], [uMax, vMax], [uMin, vMax]].map(([u, v]) => this.basis.point(u!, v!));
    this.map.buildings.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
  }

  /** Maydonga qaragan g'arbiy fasad: ayvon, kirish, qovurg'ali shimoliy qanot. */
  private westFacade() {
    const { uMin, vMin, vMax } = FARXOD_FOOTPRINT, k = FARXOD_CANOPY;
    // Ayvon ustunlari kirishdan janubga qarab; ular ustida og'ir hajm yotadi.
    for (let v = -21; v < vMax; v += 5.4) {
      this.box(uMin + .85, ARCADE_HEIGHT / 2, v, 1.7, ARCADE_HEIGHT, 1.7, 'stone', true);
      this.box(uMin + ARCADE_DEPTH - .1, ARCADE_HEIGHT / 2 - .3, v + 2.7, .14, ARCADE_HEIGHT - 1.2, 3.2, 'glass');
    }
    // Qoplamaning gorizontal choklari — tekis devorni "tosh" qiladi.
    for (let h = ARCADE_HEIGHT + 1.5; h < this.height; h += 1.5)
      this.box(uMin - .06, h, (-22 + vMax) / 2, .1, .11, vMax + 22, 'course');
    // Shimoliy qanotning tik oq qovurg'alari, orqasida qorong'i oyna.
    for (let v = vMin + 1.6; v < -22; v += 2.1) {
      this.box(uMin - .35, 5.6, v, 1.2, 11.2, .66, 'white');
      this.box(uMin + .55, 5.5, v + 1.05, .12, 10.2, 1.44, 'glass');
    }
    this.box(uMin - .3, 11.5, (vMin - 22) / 2, 1.6, .8, -22 - vMin, 'grey');
    // Bosh kirish: OSM'dagi koziryok, shisha eshiklar va keng zinapoya.
    const ku = (k.uMin + k.uMax) / 2, kv = (k.vMin + k.vMax) / 2, kd = k.vMax - k.vMin;
    this.box(ku, ARCADE_HEIGHT + .55, kv, k.uMax - k.uMin, .9, kd, 'grey');
    for (const v of [k.vMin + 1.4, k.vMax - 1.4]) this.box(k.uMin + 1.2, ARCADE_HEIGHT / 2, v, 1.4, ARCADE_HEIGHT, 1.4, 'white', true);
    this.box(uMin + ARCADE_DEPTH - .1, 3.4, kv, .2, 6.4, kd - 1.8, 'glass');
    for (let i = 0; i < 4; i++) this.box(k.uMin - .4 - i * .62, .09 * (4 - i), kv, .62, .18 * (4 - i), kd + 3.6, 'plinth', true);
    // Yuqori qavatlardagi tor tuynuklar — fotosuratdagi yopiq devor shundan.
    for (let v = -18; v < vMax - 2; v += 4.4) this.box(uMin - .04, 13.2, v, .14, 4.4, .9, 'glass');
  }

  /** Janubiy uchdagi yarim doira shishali tom — fotosuratdagi egri konstruksiya. */
  private roofVault() {
    const { uMin, vMax } = FARXOD_FOOTPRINT, r = 7.4, y0 = 13.6, cu = uMin + 7.5, steps = 14;
    for (let i = 0; i < steps; i++) {
      const a = Math.PI * i / steps, b = Math.PI * (i + 1) / steps;
      const x = cu + Math.cos(a) * r, y = y0 + Math.sin(a) * r, x2 = cu + Math.cos(b) * r, y2 = y0 + Math.sin(b) * r;
      this.add(new BoxGeometry(Math.hypot(x2 - x, y2 - y) + .05, .12, 15.4)
        .rotateZ(Math.atan2(y2 - y, x2 - x)).translate((x + x2) / 2, (y + y2) / 2, vMax - 14), 'vault');
      for (const v of [vMax - 21.7, vMax - 6.3])
        this.beam(new Vector3(x, y, v), new Vector3(x2, y2, v), .12, 'metal');
    }
    for (let i = 0; i <= steps; i += 2) {
      const a = Math.PI * i / steps, x = cu + Math.cos(a) * r, y = y0 + Math.sin(a) * r;
      this.beam(new Vector3(x, y, vMax - 21.7), new Vector3(x, y, vMax - 6.3), .1, 'metal');
    }
  }

  /** Tomdagi "ФАРХОД" — qorong'i qutida oq harflar, tunda yoritiladi. */
  private roofSign() {
    const text = 'ФАРХОД', cell = .46, gap = 1.05, step = 5 * cell + gap;
    const width = text.length * step - gap, v0 = -12 - width / 2;
    const u = FARXOD_FOOTPRINT.uMin + 1.9, y0 = this.height + 1.5;
    this.box(u, y0 + 7 * cell / 2, -12, 2.0, 7 * cell + 1.7, width + 2.6, 'brown');
    text.split('').forEach((ch, index) => {
      const rows = GLYPHS[ch]; if (!rows) return;
      // Maydondan qaraganda ko'z +u yo'nalishida boqadi, ya'ni uning O'NGI +v:
      // harflar ham, ustunlar ham v bo'yicha o'sib boradi.
      const v = v0 + index * step;
      rows.forEach((row, ry) => row.split('').forEach((c, rx) => {
        if (c !== '#') return;
        this.box(u - 1.1, y0 + (6.5 - ry) * cell, v + rx * cell + cell / 2, .2, cell * .94, cell * .94, 'white');
      }));
    });
  }

  // --- maydon -------------------------------------------------------------

  private plaza() {
    const { vMin, vMax } = FARXOD_FOOTPRINT;
    // Fasad oldidagi keng plitka; undan g'arbdagi gulzorlar OSM'dan keladi.
    this.rect(-19, 0, 38, vMax - vMin + 34, 'paving');
    for (let v = vMin - 14; v < vMax + 16; v += 11) this.rect(-19, v, 38, 2.4, 'stripe', .075);
    for (const b of FARXOD_BASIN) this.basin(b.uMin, b.uMax, b.vMin, b.vMax, b.vMin < 0);
    for (const p of FARXOD_POOLS) this.pool(p.uMin, p.uMax, p.vMin, p.vMax);
    this.monument(-12, 8);
    for (const v of [-30, -4, 22]) this.flagpole(-6.5, v);
    // Yo'lka maydon ma'lumotiga ham tushadi: mini-xarita va yo'l topish uchun.
    const a = this.basis.point(-8, vMin - 16), b = this.basis.point(-8, vMax + 16);
    this.map.roads.push({ cls: 'footway', width: 5, pts: new Float32Array([a.x, a.z, b.x, b.z]) });
  }

  private rim(uMin: number, uMax: number, vMin: number, vMax: number, h: number) {
    const cu = (uMin + uMax) / 2, cv = (vMin + vMax) / 2, w = uMax - uMin, d = vMax - vMin, y = this.y(cu, cv);
    for (const [bu, bv, bw, bd] of [[cu, vMin + .25, w, .5], [cu, vMax - .25, w, .5],
      [uMin + .25, cv, .5, d], [uMax - .25, cv, .5, d]] as const)
      this.box(bu, y + h / 2, bv, bw, h, bd, 'granite', true);
    this.rect(cu, cv, w - 1, d - 1, 'water', .18);
    const ring = [[uMin, vMin], [uMax, vMin], [uMax, vMax], [uMin, vMax]].map(([u, v]) => this.basis.point(u!, v!));
    this.map.water.push(new Float32Array(ring.flatMap(p => [p.x, p.z])));
    return { cu, cv, w, d, y };
  }

  /** "Фархад" hovuzining bir bo'lagi: granit bort, past suv yuzasi, og'izlar. */
  private basin(uMin: number, uMax: number, vMin: number, vMax: number, nozzles: boolean) {
    const { cu, w, y } = this.rim(uMin, uMax, vMin, vMax, .56);
    if (!nozzles) return;
    // Ikki qator og'iz hovuz o'qi bo'ylab — suv o'rtaga qarab yoy chizadi.
    for (let v = vMin + 3; v < vMax - 2; v += 4.2) for (const side of [-1, 1]) {
      const u = cu + side * (w / 2 - 2.2);
      this.nozzles.push({ u, v, y, reach: -side * (w / 2 - 2.2) });
      this.add(new CylinderGeometry(.1, .13, .5, 8).translate(u, y + .35, v), 'metal');
    }
  }

  /** Fasad oldidagi kvadrat hovuzchalar — har birida bitta tik favvora. */
  private pool(uMin: number, uMax: number, vMin: number, vMax: number) {
    const { cu, cv, y } = this.rim(uMin, uMax, vMin, vMax, .6);
    this.add(new CylinderGeometry(1.1, 1.4, .7, 20).translate(cu, y + .35, cv), 'granite');
    this.nozzles.push({ u: cu, v: cv, y: y + .7, reach: 0 });
  }

  /** Hovuz yonidagi bronza haykal — fotosuratdagi qo'l ko'targan figura. */
  private monument(u: number, v: number) {
    const y = this.y(u, v);
    for (let i = 0; i < 3; i++) this.box(u, y + .3 + i * .45, v, 4.6 - i * .9, .45, 4.6 - i * .9, 'granite', true);
    this.box(u, y + 2.6, v, 1.9, 2.6, 1.9, 'plinth', true);
    this.add(new CylinderGeometry(.42, .52, 2.4, 10).translate(u, y + 5.1, v), 'bronze');
    this.add(new SphereGeometry(.44, 12, 10).translate(u, y + 6.6, v), 'bronze');
    this.beam(new Vector3(u, y + 5.9, v), new Vector3(u - 1.5, y + 7.6, v - .4), .16, 'bronze');
    this.beam(new Vector3(u, y + 5.7, v), new Vector3(u + .5, y + 4.4, v + 1.1), .15, 'bronze');
  }

  private flagpole(u: number, v: number) {
    const y = this.y(u, v);
    this.add(new CylinderGeometry(.8, 1, .5, 12).translate(u, y + .25, v), 'granite');
    this.beam(new Vector3(u, y + .4, v), new Vector3(u, y + 11, v), .09, 'metal');
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(5.3, .12).setTranslation(u, y + 5.7, v), this.body);
    for (const [dy, color] of [[0, 0x159fcb], [-.42, 0xf4f2e6], [-.84, 0x319c56]] as const) {
      const key = `flag${color}`;
      this.materials[key] ??= new MeshStandardMaterial({ color, side: DoubleSide, roughness: 1 });
      this.box(u, y + 10.4 + dy, v + 1.1, .02, .42, 2.2, key);
    }
  }

  /** Maydon ichida yosh ignabarglilar, bino atrofida keng bargli daraxtlar — sun'iy yo'ldoshdagi joylashuv. */
  private planting() {
    const points: Array<{ x: number; z: number; scale: number; shape: number; kind: number }> = [];
    const add = (u: number, v: number, scale: number, shape: number) => {
      const p = this.basis.point(u, v), y = this.y(u, v);
      points.push({ x: p.x, z: p.z, scale, shape: shape === 1 ? 3 : shape, kind: 0 });
      this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1, .17).setTranslation(u, y + 1, v), this.body);
    };
    for (let v = -56; v < 58; v += 7.5) add(-5.5, v, .32, 1);
    for (let v = -60; v < 62; v += 9) add(-37, v, .38, 1);
    for (const v of [FARXOD_FOOTPRINT.vMin - 9, FARXOD_FOOTPRINT.vMax + 9])
      for (let u = 2; u < 56; u += 9) add(u, v, .95, 2);
    for (let v = -44; v < 46; v += 10) add(60, v, 1.05, 2);
    return points;
  }

  update(dt: number, night: number) {
    this.time = (this.time + Math.min(dt, .1)) % 1000;
    for (const m of this.glow) m.emissiveIntensity = night * .3;
    const p = this.jets.geometry.getAttribute('position');
    if (!this.nozzles.length) return;
    for (let i = 0; i < p.count; i++) {
      const n = this.nozzles[i % this.nozzles.length]!;
      const t = (this.time * .55 + i * .61803398875) % 1;
      if (n.reach === 0) { // kvadrat hovuzcha: tik otiladi
        const a = i * 2.39996, r = .1 + t * .9;
        p.setXYZ(i, n.u + Math.cos(a) * r, n.y + .4 + Math.sin(t * Math.PI) * 7.5, n.v + Math.sin(a) * r);
        continue;
      }
      p.setXYZ(i, n.u + n.reach * t, n.y + .6 + Math.sin(t * Math.PI) * 3.4, n.v + (i % 3 - 1) * .12);
    }
    p.needsUpdate = true;
  }

  dispose() {
    if (this.trees) { for (const m of this.trees.meshes) m.removeFromParent(); disposeTrees(this.trees); }
    this.furniture.removeFromParent(); disposeCityDetails(this.furniture);
    this.group.traverse(n => { if (n instanceof Mesh || n instanceof Points) n.geometry.dispose(); });
    for (const m of Object.values(this.materials)) m.dispose();
    this.jets.material.dispose();
    this.physics.world.removeRigidBody(this.body);
    this.group.clear();
  }
}
