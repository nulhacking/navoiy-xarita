import {
  BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshStandardMaterial, Quaternion, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityFrame } from './CityFrame.ts';
import type { Ground } from './Ground.ts';
import type { CityMapData } from './CityTile.ts';
import { Physics, RAPIER } from './Physics.ts';
import { SOFTEX_DRAIN, SOFTEX_NEIGHBOUR, SOFTEX_PLAN, softexBasis } from './SoftexReference.ts';
import { assetTrees } from './TreeAssets.ts';
import { disposeTrees, type TreeMeshes } from './trees.ts';
import { buildParkFurniture, disposeCityDetails } from './CityDetails.ts';
import { parkPavingTexture } from './SurfaceMaterials.ts';
import { QUALITY } from './Quality.ts';

/**
 * Harf shakllari — belgilar qutisi 1 x 1 birlik, ichida to'rtburchaklar.
 *
 * Nima uchun tayyor shrift emas: `TextGeometry` uchun alohida shrift fayli
 * kerak bo'lardi, u esa yana bitta yuklanadigan asset va yana bitta litsenziya.
 * Yozuv o'yin masshtabida uzoqdan o'qiladi, shuning uchun oddiy blok harflar
 * yetarli. `X` diagonal, uni ikkita qiya nur bilan quramiz.
 */
const GLYPHS: Record<string, Array<[number, number, number, number]>> = {
  S: [[0, .82, 1, .18], [0, .45, .18, .37], [0, .41, 1, .18], [.82, .18, .18, .27], [0, 0, 1, .18]],
  O: [[0, 0, .18, 1], [.82, 0, .18, 1], [0, .82, 1, .18], [0, 0, 1, .18]],
  F: [[0, 0, .18, 1], [0, .82, 1, .18], [0, .44, .72, .16]],
  T: [[.41, 0, .18, 1], [0, .82, 1, .18]],
  E: [[0, 0, .18, 1], [0, .82, 1, .18], [0, .42, .78, .16], [0, 0, 1, .18]],
};

/**
 * SOFTEX markazi va uning atrofi.
 *
 * Poydevor OSM'dan, ko'rinish esa ko'cha darajasidagi fotosuratdan:
 * ikki qavat, yumaloq janubi-g'arbiy burchak, ochiq ayvon, jigarrang
 * yog'och taqlidli panellar va parapetdagi ko'k yozuv. Atrofi — g'ishtli
 * maydoncha, avtoturargoh chiziqlari, ignabargli daraxtlar va sharqdagi
 * sug'orish arig'i.
 */
export class Softex {
  readonly group = new Group();
  readonly map: CityMapData = { buildings: [], roads: [], water: [], areas: [] };
  readonly basis: ReturnType<typeof softexBasis>;
  readonly base: number;
  /** Ariq halqasi — `CityWorld` uni suv zonalariga qo'shadi. */
  readonly drainRing: Float32Array;
  readonly drainLevel: number;

  private readonly body: RAPIER.RigidBody;
  private readonly parts = new Map<string, BufferGeometry[]>();
  private readonly materials: Record<string, MeshStandardMaterial>;
  private trees: TreeMeshes | null = null;
  private readonly furniture: Group;

  constructor(frame: CityFrame, private ground: Ground, private physics: Physics) {
    this.basis = softexBasis(frame);
    this.base = ground.heightAt(this.basis.origin.x, this.basis.origin.z);
    this.group.name = 'SOFTEX · dasturiy mahsulotlar markazi';
    this.group.position.set(this.basis.origin.x, this.base, this.basis.origin.z);
    this.group.rotation.y = Math.atan2(-this.basis.east.z, this.basis.east.x);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.group.position.x, this.base, this.group.position.z)
      .setRotation(this.group.quaternion));

    const material = (color: number, roughness = .84, metalness = 0) =>
      new MeshStandardMaterial({ color, roughness, metalness });
    this.materials = {
      // Fotosuratdagi ranglar: oq shtukatur, to'q kulrang kompozit lenta,
      // jigarrang yog'och taqlidli panel, parda ortidagi sarg'ish oyna.
      white: material(0xf1f2ee, .78),
      charcoal: material(0x3b4149, .66),
      timber: material(0x8b5a2c, .74),
      glass: material(0x6e4b21, .22, .32),
      door: material(0x24282d, .28, .35),
      sign: material(0x1a7fd4, .38, .18),
      metal: material(0x8d959b, .42, .55),
      concrete: material(0xb9b7ac, .92),
      paving: material(0xc6c4bb, .9),
      stripe: material(0xe8e7e0, .88),
      kerb: material(0x9d9a90, .9),
      water: material(0x4e7a78, .24, .1),
      billboard: material(0x2a6fb0, .6),
    };
    for (const key of ['paving', 'stripe', 'kerb']) {
      const m = this.materials[key]!;
      m.polygonOffset = true; m.polygonOffsetFactor = key === 'stripe' ? -13 : -12;
      m.polygonOffsetUnits = m.polygonOffsetFactor * 3; m.side = DoubleSide;
      if (key !== 'stripe') m.map = parkPavingTexture();
    }
    this.materials.water!.polygonOffset = true;
    this.materials.water!.polygonOffsetFactor = -14;
    this.materials.water!.polygonOffsetUnits = -42;
    this.materials.water!.side = DoubleSide;

    this.shell();
    this.facade();
    this.entrance();
    this.signage();
    this.roof();
    this.neighbour();
    const drain = this.site();
    this.drainRing = drain.ring;
    this.drainLevel = drain.level;
    const treePoints = this.planting();

    for (const [key, geometries] of this.parts) {
      const geometry = mergeGeometries(geometries)!;
      for (const g of geometries) g.dispose();
      const mesh = new Mesh(geometry, this.materials[key]);
      mesh.name = `Softex · ${key}`;
      mesh.castShadow = !['paving', 'stripe', 'kerb', 'water'].includes(key);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.parts.clear();

    // Import qilingan daraxtlar dunyo koordinatasida — ularni teskari
    // transformli guruhga qo'yamiz (Hokimiyat'dagi kabi).
    const worldDetails = new Group();
    worldDetails.name = 'Softex · world-space landscaping';
    worldDetails.position.copy(this.group.position).negate().applyQuaternion(this.group.quaternion.clone().invert());
    worldDetails.quaternion.copy(this.group.quaternion).invert();
    this.group.add(worldDetails);
    const meshes = assetTrees(treePoints, (x, z) => ground.heightAt(x, z));
    if (meshes) {
      for (const lod of meshes) if (lod.levels[1]) lod.levels[1].distance = QUALITY.treeDetail(520);
      this.trees = { meshes, count: treePoints.length, sharedAssets: true };
      worldDetails.add(...meshes);
    }
    const lamps = [-2, -13, -24, -35, -46].map((v) => {
      const p = this.basis.point(-21.9, v);
      return { x: p.x, z: p.z, yaw: this.group.rotation.y };
    });
    this.furniture = buildParkFurniture(lamps, ground);
    worldDetails.add(this.furniture);

    this.group.userData = {
      sourceIds: [1060955250],
      trees: treePoints.length,
      facade: 'street-photo authored: rounded SW corner, timber panels, blue sign',
      footprint: 'OSM way 1060955250, southern block',
      dimensions: 'two levels from OSM; band heights estimated from the photo',
    };
  }

  /** Relyefning shu nuqtadagi balandligi, bino poydevoriga nisbatan. */
  private y(u: number, v: number): number {
    const p = this.basis.point(u, v);
    return this.ground.heightAt(p.x, p.z) - this.base;
  }

  private add(geometry: BufferGeometry, key: string): void {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    const position = flat.getAttribute('position');
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) { uv[i * 2] = position.getX(i) / 4; uv[i * 2 + 1] = position.getZ(i) / 4; }
    flat.setAttribute('uv', new BufferAttribute(uv, 2));
    const bucket = this.parts.get(key) ?? [];
    bucket.push(flat);
    this.parts.set(key, bucket);
  }

  private box(u: number, y: number, v: number, w: number, h: number, d: number, key: string, collision = false): void {
    this.add(new BoxGeometry(w, h, d).translate(u, y, v), key);
    if (collision) {
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(u, y, v), this.body);
    }
  }

  private beam(a: Vector3, b: Vector3, radius: number, key: string): void {
    const delta = b.clone().sub(a), length = delta.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize());
    const p = a.clone().add(b).multiplyScalar(.5);
    this.add(new CylinderGeometry(radius, radius, length, 6).applyQuaternion(q).translate(p.x, p.y, p.z), key);
  }

  /**
   * Bino rejasi — to'g'ri devorlar va yumaloq janubi-g'arbiy burchak.
   *
   * `inset` bilan bir xil shakl ichkariga suriladi: ayvon (birinchi qavat
   * ostidagi ochiq bo'shliq) shu tarzda quriladi.
   */
  private outline(inset: number): Vector2[] {
    const { west, east, south, north, corner } = SOFTEX_PLAN;
    const r = corner - inset;
    const cu = west + corner, cv = south - corner;
    const points: Vector2[] = [new Vector2(east - inset, north + inset), new Vector2(east - inset, south - inset)];
    // Yoy: janubdan g'arbga, 8 bo'lak — o'yin masshtabida silliq ko'rinadi.
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      points.push(new Vector2(cu - Math.sin(a) * r, cv + Math.cos(a) * r));
    }
    points.push(new Vector2(west + inset, north + inset));
    return points;
  }

  /** Reja chizig'i bo'ylab vertikal lenta. Ichkarisi ko'rinmaydi, tashqarisi yopiq. */
  private band(points: Vector2[], y0: number, y1: number, key: string, close = false): void {
    const positions: number[] = [];
    const limit = close ? points.length : points.length - 1;
    for (let i = 0; i < limit; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      positions.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y,
        a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    this.add(geometry, key);
  }

  /** Tekis tom/soffit — reja ko'pburchagini to'ldiradi. */
  private slab(points: Vector2[], y: number, key: string): void {
    const positions: number[] = [];
    for (let i = 1; i + 1 < points.length; i++) {
      const a = points[0]!, b = points[i]!, c = points[i + 1]!;
      positions.push(a.x, y, a.y, b.x, y, b.y, c.x, y, c.y);
      positions.push(a.x, y, a.y, c.x, y, c.y, b.x, y, b.y);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    this.add(geometry, key);
  }

  private shell(): void {
    const { ground, upper, parapet, recess, west, east, south, north } = SOFTEX_PLAN;
    const outer = this.outline(0), inner = this.outline(recess);
    const top = ground + upper + parapet;

    // Birinchi qavat ostidagi ayvon: pastki hajm ichkarida, tepasi tashqarida.
    this.band(inner, -.4, ground, 'charcoal', true);
    this.slab(outer, ground, 'charcoal');           // ayvon shifti
    this.band(outer, ground, ground + .55, 'timber', true);   // chiqib turgan jigarrang lenta
    this.band(outer, ground + .55, ground + upper, 'white', true);
    this.band(outer, ground + upper, top, 'white', true);
    this.slab(outer, top, 'white');
    // Parapet tepasidagi soya chizig'i.
    this.band(outer, ground + upper - .12, ground + upper + .06, 'charcoal', true);

    // Fizika: yumaloq burchakni ham qamrab oladigan oddiy qutilar.
    this.physics.world.createCollider(RAPIER.ColliderDesc
      .cuboid((east - west) / 2, top / 2, (south - north) / 2)
      .setTranslation((east + west) / 2, top / 2, (south + north) / 2), this.body);
  }

  /**
   * G'arbiy (ko'chaga qaragan) fasad: ikkita katta jigarrang panel, ular
   * orasida oyna, o'rtadan o'tgan to'q kulrang lenta.
   */
  private facade(): void {
    const { ground, upper, west, north } = SOFTEX_PLAN;
    const y0 = ground + .55, y1 = ground + upper;
    const u = west - .02;
    // Fotosuratda tekis qanotda ikkita baland jigarrang panel, ular orasida
    // va chetlarida oyna. Panel qadamini shunga moslaymiz.
    for (let i = 0; i < 7; i++) {
      const v = -3.6 - i * 3.0;
      if (v < north + 1) break;
      const timber = i === 1 || i === 3;
      this.box(u - .06, (y0 + y1) / 2 + .05, v, .12, y1 - y0 - .34, 2.52, timber ? 'timber' : 'glass');
      this.box(u - .04, (y0 + y1) / 2, v + 1.5, .1, y1 - y0, .48, 'white');
    }
    // Oynalarni ikkiga bo'luvchi to'q kulrang lenta — fotosuratdagi eng
    // ko'zga tashlanadigan gorizontal chiziq. Yuqorisidagi ikkinchi lenta
    // parapetni oynadan ajratadi, aks holda fasadning tepasi bo'sh oq
    // maydonga aylanib qolardi.
    this.band(this.outline(-.03), y0 + 1.5, y0 + 2.0, 'charcoal', true);
    this.band(this.outline(-.03), y1 - .3, y1 + .02, 'charcoal', true);
    this.band(this.outline(-.03), y0 - .06, y0 + .12, 'charcoal', true);

    // Yumaloq burchakdagi uzluksiz oyna: yoy bo'ylab tor panellar.
    const arc = this.outline(-.04).slice(2, 11);
    for (let i = 0; i + 1 < arc.length; i++) {
      const a = arc[i]!, b = arc[i + 1]!;
      const mid = a.clone().add(b).multiplyScalar(.5), delta = b.clone().sub(a);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(delta.x, delta.y));
      this.add(new BoxGeometry(.1, y1 - y0 - .34, delta.length()).applyQuaternion(q)
        .translate(mid.x, (y0 + y1) / 2 + .05, mid.y), 'glass');
      this.add(new BoxGeometry(.14, y1 - y0, .14).translate(a.x, (y0 + y1) / 2, a.y), 'white');
    }

    // Devordagi ikkita konditsioner — fotosuratda tekis qanotda.
    for (const v of [-8.4, -14.2]) {
      this.box(west - .45, ground + upper - 1.1, v, .8, .6, 1.0, 'white');
      this.box(west - .86, ground + upper - 1.1, v, .05, .45, .8, 'metal');
    }
    // Yomg'ir suvi trubasi.
    this.beam(new Vector3(west - .18, 0, north + .6), new Vector3(west - .18, ground + upper + 1.2, north + .6), .075, 'metal');
  }

  /** Ayvon ostidagi kirish: ustunlar, shisha eshiklar va zinapoya. */
  private entrance(): void {
    const { ground, recess, west, south, corner } = SOFTEX_PLAN;
    const inner = this.outline(recess);
    // Ayvon ustunlari — yoy bo'ylab va tekis devorda.
    for (const p of [inner[1]!, inner[3]!, inner[6]!, inner[9]!, inner[10]!]) {
      this.box(p.x, ground / 2, p.y, .34, ground, .34, 'charcoal', true);
    }
    // Shisha eshik yumaloq burchakning o'rtasida — fotosuratdagi kabi.
    const cu = west + corner, cv = south - corner, r = corner - recess;
    for (let i = -1; i <= 1; i++) {
      const a = Math.PI / 4 + i * .22;
      const x = cu - Math.sin(a) * r, z = cv + Math.cos(a) * r;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a);
      this.add(new BoxGeometry(.08, 2.6, 1.15).applyQuaternion(q).translate(x, 1.35, z), 'door');
    }
    // Uch zinapoya: yoyga parallel, tashqariga kengayib boradi.
    for (let step = 0; step < 3; step++) {
      const rr = r + .5 + step * .45, h = .18 * (3 - step);
      const points: Vector2[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI / 4 + (i / 10 - .5) * 1.5;
        points.push(new Vector2(cu - Math.sin(a) * rr, cv + Math.cos(a) * rr));
      }
      this.band(points, this.y(points[5]!.x, points[5]!.y), h, 'concrete');
      this.slab(points, h, 'concrete');
    }
    this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(.3, r + 1.5)
      .setTranslation(cu, .3, cv), this.body);
  }

  /**
   * Parapetdagi ko'k "SOFTEX" — yumaloq burchak ustida, ko'chaga qaragan.
   *
   * Harf tekisligi yoyga URINMA bo'lishi kerak, radius bo'ylab emas: avval
   * kvaternion harfni radius bo'ylab yotqizardi va keng gorizontal chiziqlar
   * devor ichiga kirib ko'rinmay qolardi (faqat tik tayoqchalar qolardi).
   */
  private signage(): void {
    const { ground, upper, west, south, corner } = SOFTEX_PLAN;
    const y = ground + upper + .42;
    const height = .78, width = .56;
    const cu = west + corner, cv = south - corner;
    // Harflar devordan bir oz chiqib turadi — aks holda yoyning egriligi
    // ularning chetini yutib yuboradi.
    const r = corner + .14;
    const text = 'SOFTEX';
    const span = 1.16;
    for (let i = 0; i < text.length; i++) {
      const angle = Math.PI / 4 - (i / (text.length - 1) - .5) * span;
      const x = cu - Math.sin(angle) * r, z = cv + Math.cos(angle) * r;
      // Mahalliy X — yoyning tashqi normali, Z — urinma: harf devorga yopishib
      // yotadi va butun kengligi bo'ylab ko'rinadi.
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -(angle + Math.PI / 2));
      const letter = text[i]!;
      if (letter === 'X') {
        for (const sign of [-1, 1]) {
          this.add(new BoxGeometry(.11, Math.hypot(height, width) - .08, .16)
            .rotateX(sign * Math.atan2(width, height))
            .translate(0, height / 2, 0)
            .applyQuaternion(q).translate(x, y, z), 'sign');
        }
        continue;
      }
      for (const [gx, gy, gw, gh] of GLYPHS[letter] ?? []) {
        this.add(new BoxGeometry(.11, gh * height, gw * width)
          // Manfiy: urinma o'qi tomoshabin uchun O'NGDAN CHAPGA yo'nalgan,
          // shuning uchun harf ichidagi siljish teskari.
          .translate(0, (gy + gh / 2) * height, -(gx + gw / 2 - .5) * width)
          .applyQuaternion(q).translate(x, y, z), 'sign');
      }
    }
  }

  private roof(): void {
    const { ground, upper, parapet } = SOFTEX_PLAN;
    const top = ground + upper + parapet;
    // Tom uskunasi: konditsioner bloklari, lyuk va antenna.
    for (const [u, v] of [[-2, -6], [1, -12], [-5, -18]]) {
      this.box(u!, top + .35, v!, 1.5, .7, 1.1, 'metal');
      this.box(u!, top + .74, v!, 1.2, .08, .85, 'charcoal');
    }
    this.box(-7, top + .3, -22, 1.1, .6, 1.1, 'white');
    this.beam(new Vector3(2.4, top, -3), new Vector3(2.4, top + 3.2, -3), .05, 'metal');
    for (let i = 0; i < 3; i++) this.box(2.4, top + 2.2 + i * .35, -3, .06, .05, .7, 'metal');
  }

  /**
   * Qatorning qolgan qismi: SOFTEX'dan shimoldagi past savdo do'konlari.
   *
   * OSM way butunligicha bizning qo'limizda, shuning uchun qolgan 90 metrni
   * ham shu yerda quramiz — aks holda ko'chada bo'shliq qolardi.
   */
  private neighbour(): void {
    const { west, east, from, to, height } = SOFTEX_NEIGHBOUR;
    const points = [new Vector2(east, from), new Vector2(east, to), new Vector2(west, to), new Vector2(west, from)];
    this.band(points, -.4, height, 'white', true);
    this.slab(points, height, 'white');
    this.band(points, height - .5, height + .25, 'charcoal', true);
    this.physics.world.createCollider(RAPIER.ColliderDesc
      .cuboid((east - west) / 2, height / 2, (from - to) / 2)
      .setTranslation((east + west) / 2, height / 2, (from + to) / 2), this.body);
    // Do'kon vitrinalari va soyabonlar.
    for (let v = from - 4; v > to + 3; v -= 6.5) {
      this.box(west - .06, 1.5, v, .12, 2.4, 4.4, 'glass');
      this.box(west - .55, 3.1, v, 1.1, .16, 4.8, 'charcoal');
      this.box(west - .04, 4.3, v, .1, 1.1, 4.4, 'timber');
    }
    // Fotosuratda chap tomondagi ko'k reklama shiti.
    this.box(west - .12, 2.4, from - 2.2, .18, 2.0, 3.4, 'billboard');
  }

  private groundQuad(a: Vector2, b: Vector2, c: Vector2, d: Vector2, key: string): void {
    const nx = Math.max(1, Math.ceil(a.distanceTo(b) / 3)), nz = Math.max(1, Math.ceil(a.distanceTo(d) / 3));
    const positions: number[] = [];
    const at = (u: number, v: number) => {
      const p = a.clone().lerp(b, u).lerp(d.clone().lerp(c, u), v);
      return [p.x, this.y(p.x, p.y) + .012, p.y];
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++)
      for (const [u, v] of [[i / nx, j / nz], [i / nx, (j + 1) / nz], [(i + 1) / nx, (j + 1) / nz],
        [i / nx, j / nz], [(i + 1) / nx, (j + 1) / nz], [(i + 1) / nx, j / nz]])
        positions.push(...at(u!, v!));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    this.add(geometry, key);
  }

  private rect(u: number, v: number, w: number, d: number, key: string): void {
    this.groundQuad(new Vector2(u - w / 2, v - d / 2), new Vector2(u + w / 2, v - d / 2),
      new Vector2(u + w / 2, v + d / 2), new Vector2(u - w / 2, v + d / 2), key);
  }

  /** Maydoncha, avtoturargoh chiziqlari, bordyur va sug'orish arig'i. */
  private site(): { ring: Float32Array; level: number } {
    const { west, north } = SOFTEX_PLAN;
    // G'ishtli maydoncha: ko'cha bordyuridan (u = -23) bino ayvonigacha.
    // Kenglik 13 m — yaqin qatnov qismi u = -23.5 dan boshlanadi, shuning
    // uchun maydoncha asfaltning ustiga chiqmaydi.
    this.rect(-16.6, -48, 12.8, 120, 'paving');
    // Turargoh chiziqlari — fotosuratdagi kabi fasadga tik.
    for (let v = -2; v > -30; v -= 2.6) {
      this.groundQuad(new Vector2(west - 5.6, v), new Vector2(west - .9, v),
        new Vector2(west - .9, v + .14), new Vector2(west - 5.6, v + .14), 'stripe');
    }
    // Ko'cha bordyuri.
    for (let v = 10; v > -118; v -= 4) {
      const y = this.y(-23.1, v);
      this.box(-23.1, y + .07, v - 2, .34, .14, 4, 'kerb');
    }
    // Maydoncha xarita ma'lumotida ham bo'lsin: mini-xaritada va NPC yo'l
    // tarmog'ida u ochiq yuza sifatida ko'rinadi.
    const corners = [[-23, 12], [west - .6, 12], [west - .6, north - 96], [-23, north - 96]]
      .map(([u, v]) => this.basis.point(u!, v!));
    this.map.areas.push({ cls: 'parking', pts: new Float32Array(corners.flatMap((p) => [p.x, p.z])) });

    // --- Sug'orish arig'i ---
    const { u, from, to, width, depth } = SOFTEX_DRAIN;
    const half = width / 2;
    // Beton nov: ikki yon devor va tubi. Relyef to'ri buni chuqur o'yolmaydi,
    // shuning uchun u sirtda yotgan sayoz nov.
    for (const side of [-1, 1]) {
      for (let v = from; v > to; v -= 6) {
        const y = this.y(u + side * half, v - 3);
        this.box(u + side * (half + .22), y + .18, v - 3, .44, .36, 6, 'concrete', true);
      }
    }
    this.groundQuad(new Vector2(u - half, from), new Vector2(u + half, from),
      new Vector2(u + half, to), new Vector2(u - half, to), 'water');
    const ring: number[] = [];
    for (const [du, v] of [[-half, from], [half, from], [half, to], [-half, to]] as const) {
      const p = this.basis.point(u + du, v);
      ring.push(p.x, p.z);
    }
    ring.push(ring[0]!, ring[1]!);
    this.map.water.push(new Float32Array(ring));
    const level = this.base + this.y(u, (from + to) / 2) + depth;
    return { ring: new Float32Array(ring), level };
  }

  private planting(): Array<{ x: number; z: number; scale: number; shape: number; kind: number }> {
    const points: Array<{ x: number; z: number; scale: number; shape: number; kind: number }> = [];
    const add = (u: number, v: number, scale: number) => {
      const p = this.basis.point(u, v);
      // Daraxt kollideri yo'q: to'siq va yiqilish `Breakables` da.
      points.push({ x: p.x, z: p.z, scale, shape: 3, kind: 0 });
    };
    // Fotosuratdagi baland ignabargli daraxtlar — maydoncha chetida qator.
    for (let v = 4; v > -108; v -= 12) add(-20.6, v, .95 + (Math.sin(v * .7) * .12));
    for (const v of [3, -30]) add(-12.4, v, .74);
    // Ariq bo'yidagi soyabon daraxtlar.
    for (let v = 8; v > -78; v -= 13) add(SOFTEX_DRAIN.u + 3.4, v, .68);
    return points;
  }

  dispose(): void {
    if (this.trees) { for (const m of this.trees.meshes) m.removeFromParent(); disposeTrees(this.trees); }
    this.furniture.removeFromParent();
    disposeCityDetails(this.furniture);
    this.group.traverse((n) => { if (n instanceof Mesh) n.geometry.dispose(); });
    for (const m of Object.values(this.materials)) m.dispose();
    this.physics.world.removeRigidBody(this.body);
    this.group.clear();
  }
}
