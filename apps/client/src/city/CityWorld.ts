import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  Vector3,
} from 'three';

import { type TileCoord, lonLatToTile, tileKey, tileUvToLonLat } from '@xarita/geo';

import type { Engine, FrameContext } from '../engine/Engine.ts';
import { OsmSource } from './OsmSource.ts';
import { TerrainSource } from './sources.ts';
import { CityFrame } from './CityFrame.ts';
import { type CityOverview, buildCityOverview } from './CityOverview.ts';
import { CityTile, type CityMapData } from './CityTile.ts';
import { Ground } from './Ground.ts';
import type { Input } from './Input.ts';
import { type LoadedModel, cloneModel, loadCharacter, loadVehicle, loadPedestrians } from './models.ts';
import { Physics, RAPIER } from './Physics.ts';
import { Player, type PlayerState } from './Player.ts';
import { Traffic } from './Traffic.ts';
import { loadFleet, vehicleSpec } from './FleetAssets.ts';
import { ParkedVehicles } from './ParkedVehicles.ts';
import { loadTreeAssets } from './TreeAssets.ts';
import { loadCityProps, setStreetLightLevel } from './CityDetails.ts';
import { Sky, type SkyState } from './Sky.ts';
import { WorldClock } from './WorldClock.ts';
import { isNavoiLake } from './LakeReference.ts';
import { NavoiLakePark } from './NavoiLakePark.ts';
import { Hokimiyat } from './Hokimiyat.ts';
import { Farxod } from './Farxod.ts';
import { Softex } from './Softex.ts';
import { XalqlarDostligi } from './XalqlarDostligi.ts';
import { liteMaterials } from './LiteMaterials.ts';
import { LOW_QUALITY, QUALITY } from './Quality.ts';

/** Geometriya yuklanadigan radius, tayl birligida (z14 tayl ≈ 1.9 km). */
// Fog 2.4 km dan keyin sahnani yopadi; 5x5 tayl GPUga ortiqcha yuk edi.
const RENDER_RADIUS = 1;
/** Fizika collideri qo'shiladigan radius — undan kichik, chunki qimmatroq. */
const PHYSICS_RADIUS = 1;

const SELECT_HZ = 3;

/** Metka ustunining balandligi, metr. */
const WAYPOINT_HEIGHT = 120;

export interface CityStats {
  tiles: number;
  buildings: number;
  triangles: number;
  physicsTiles: number;
  loading: number;
  cars: number;
  people: number;
}

export interface CityWorldOptions {
  engine: Engine;
  input: Input;
  onError?: (message: string) => void;
}

/**
 * Navoiy — o'ynaladigan shahar.
 *
 * Sayyora versiyasi (globus, quadtree, floating origin) bu yerda YO'Q va
 * ataylab yo'q: bitta shahar uchun ularning hech biri kerak emas, va ularsiz
 * butun tizim sezilarli sodda. Buning o'rniga:
 *   - bitta qo'zg'almas mahalliy freym (`CityFrame`),
 *   - bitta relyef meshi va bitta heightfield collider (`Ground`),
 *   - o'yinchi atrofida oqib keladigan bino/yo'l tayllari (`CityTile`),
 *   - piyoda va mashina uchun kinematik fizika (`Player`).
 */
export class CityWorld {
  readonly group = new Group();
  frame: CityFrame | null = null;
  ground: Ground | null = null;
  physics: Physics | null = null;
  player: Player | null = null;
  traffic: Traffic | null = null;
  parked: ParkedVehicles | null = null;
  lake: NavoiLakePark | null = null;
  hokimiyat: Hokimiyat | null = null;
  farxod: Farxod | null = null;
  softex: Softex | null = null;
  xalqlar: XalqlarDostligi | null = null;
  paused = false;
  private teleporting = false;
  private mapsDirty = false;
  private wantedTiles = new Set<string>();
  private readonly loadJobs = new Map<string, Promise<void>>();

  private readonly engine: Engine;
  private readonly input: Input;
  private readonly onError: ((message: string) => void) | undefined;

  private readonly osm = new OsmSource();
  private readonly terrain = new TerrainSource();

  private readonly tiles = new Map<string, CityTile>();
  private readonly loading = new Set<string>();
  private readonly physicsTiles = new Set<string>();

  private readonly sky: Sky;
  /** Dunyo vaqti: jonli soat yoki undan surilgan lahza. */
  readonly clock = new WorldClock();
  private currentSky: SkyState | null = null;

  private selectTimer = 0;
  private disposed = false;
  private ready = false;
  private waypointMesh: Mesh | null = null;
  private overviewCache: CityOverview | null = null;
  private overviewPromise: Promise<CityOverview | null> | null = null;

  stats: CityStats = { tiles: 0, buildings: 0, triangles: 0, physicsTiles: 0, loading: 0, cars: 0, people: 0 };

  constructor(options: CityWorldOptions) {
    this.engine = options.engine;
    this.input = options.input;
    this.onError = options.onError;

    const { scene, renderer } = options.engine;
    scene.add(this.group);

    // three PCFSoftShadowMap ni eskirgan deb belgilab, uni baribir
    // PCFShadowMap ga tushiradi — shuning uchun to'g'ridan-to'g'ri shuni
    // beramiz. Qolgan barcha yorug'lik sozlamasi `Sky` ning ishi.
    renderer.shadowMap.type = PCFShadowMap;
    this.sky = new Sky(scene, renderer);
  }

  /** Indeks, relyef va fizikani tayyorlaydi. Tugagach o'yin boshlanadi. */
  async load(): Promise<void> {
    await this.osm.loadIndex();
    const bbox = this.osm.bbox;
    if (!bbox) {
      this.onError?.(
        'OSM ma\'lumoti topilmadi. `node tools/osm-pipeline/bake.mjs navoiy` ni ishga tushiring.',
      );
      return;
    }

    const [south, west, north, east] = bbox;
    const center = { lat: (south + north) / 2, lon: (west + east) / 2, alt: 0 };
    this.frame = new CityFrame(center);

    const waterRings=await this.osm.waterRings();
    this.ground = await Ground.load(this.frame, bbox, this.terrain, waterRings);
    if (this.disposed) return;
    this.group.add(this.ground.mesh);

    this.physics = await Physics.create();
    if (this.disposed) return;
    this.physics.addGround(this.ground);

    // Spawn KO'CHADA bo'lishi kerak. Shahar markazining geometrik nuqtasi
    // ko'pincha bino ichiga tushadi — u yerda personaj devor bilan qamalib
    // qoladi va joyidan qimirlay olmaydi. Shuning uchun markazga eng yaqin
    // haqiqiy yo'l nuqtasini topamiz.
    const center3 = this.frame.toLocal({ ...center, alt: 0 });
    const spawn = (await this.findRoadSpawn(center3, true)) ?? center3;
    spawn.y = this.ground.heightAt(spawn.x, spawn.z);

    // Modellar parallel yuklanadi. Biror biri kelmasa — o'yin baribir
    // ishlaydi, faqat oddiy shakl bilan.
    const [character, vehicle, pedestrians, signalData, fleet] = await Promise.all([
      loadCharacter().catch((error: unknown) => {
        this.onError?.(`Personaj modeli yuklanmadi: ${(error as Error).message}`);
        return null;
      }),
      // Sport avtomobil (CarConcept) bitta o'zi ~1 mln uchburchak va 175 draw call —
      // butun shahar kadridan og'ir. Yengil rejimda u umuman yuklanmaydi.
      (LOW_QUALITY ? Promise.resolve(null) : loadVehicle()).catch((error: unknown) => {
        this.onError?.(`Mashina modeli yuklanmadi: ${(error as Error).message}`);
        return null;
      }),
      loadPedestrians().catch((error: unknown) => { this.onError?.(`Piyoda modellari: ${(error as Error).message}`); return []; }),
      fetch('/osm/signals.json').then(r => { if(!r.ok) throw new Error('Svetofor ma’lumoti yuklanmadi'); return r.json() as Promise<{signals:Array<{lat:number;lon:number}>}>; })
        .catch((error: unknown) => { this.onError?.((error as Error).message); return {signals:[]}; }),
      loadFleet().catch((error:unknown)=>{this.onError?.(`Transport modellari: ${(error as Error).message}`);return [];}),
      loadTreeAssets().catch((error:unknown)=>{this.onError?.(`Daraxt modellari: ${(error as Error).message}`);}),
      loadCityProps().catch((error:unknown)=>{this.onError?.(`Ko‘cha modellari: ${(error as Error).message}`);}),
    ]);
    if (this.disposed) return;

    this.traffic = new Traffic(this.physics, this.ground, [...(character ? [character] : []), ...pedestrians], vehicle,
      signalData.signals.map(p => this.frame!.toLocal({...p,alt:0})),fleet);
    this.group.add(this.traffic.group);
    this.parked=new ParkedVehicles(this.physics);this.group.add(this.parked.group);
    this.player = new Player({
      physics: this.physics,
      ground: this.ground,
      input: this.input,
      camera: this.engine.camera,
      spawn,
      ...(character ? { characterModel: cloneModel(character) satisfies LoadedModel } : {}),
      ...(vehicle ? { vehicleModel: cloneModel(vehicle) satisfies LoadedModel }
        : fleet[0] ? { vehicleModel: cloneModel(fleet[0]) satisfies LoadedModel } : {}),
      trafficVehicleDistance: (position,radius) => {
        const d=Math.min(this.traffic?.nearestVehicleDistance(position,radius)??Infinity,this.parked?.nearestDistance(position,radius)??Infinity);
        return Number.isFinite(d)?d:null;
      },
      claimTrafficVehicle: (position,radius) => {
        const traffic=this.traffic?.nearestVehicleDistance(position,radius)??Infinity,parked=this.parked?.nearestDistance(position,radius)??Infinity;
        return parked<=traffic?this.parked?.claim(position,radius)??null:this.traffic?.claimVehicle(position,radius)??null;
      },
      releaseVehicle: vehicle => this.parked?.add(vehicle),
      // `exactOptionalPropertyTypes` yoqilgan: yo'q maydonni `undefined`
      // bilan emas, umuman yubormaslik kerak.
      ...(this.carSpawn ? { carSpawn: this.carSpawn } : {}),
    });
    this.group.add(this.player.group);

    // Birinchi kadrdan oldin o'yinchi atrofidagi tayllar tayyor bo'lsin —
    // aks holda u bo'sh relyefda paydo bo'ladi va binolar keyin "otilib" chiqadi.
    await this.select(true);
    // A small selection near the starting street makes every transport type discoverable.
    for(let i=0;i<fleet.length;i++) {
      const nearby=await this.findRoadSpawn(new Vector3(spawn.x+18+i*14,0,spawn.z+12),false);
      if(!nearby)continue;
      const model=cloneModel(fleet[i]!),spec=vehicleSpec(model.object);
      // Faqat 2 sm zaxira: turgan transport yerga tegib turishi kerak,
      // ilgarigi 8 sm da g'ildiraklar asfaltdan uzilib ko'rinardi.
      const p=new Vector3(nearby.x,this.ground.heightAt(nearby.x,nearby.z)+spec.half.y+.02,nearby.z);
      if(this.physics.world.intersectionWithShape(p,{x:0,y:0,z:0,w:1},new RAPIER.Cuboid(spec.half.x,spec.half.y,spec.half.z)))continue;
      this.parked.add({object:model.object,position:p,yaw:0,speed:0});
    }
    const lakeRing=waterRings.find(isNavoiLake);
    if(lakeRing){this.lake=new NavoiLakePark(this.frame,this.ground,this.physics,lakeRing,this.mapTiles());this.group.add(this.lake.group);}
    this.hokimiyat=new Hokimiyat(this.frame,this.ground,this.physics);this.group.add(this.hokimiyat.group);
    this.farxod=new Farxod(this.frame,this.ground,this.physics);this.group.add(this.farxod.group);
    this.softex=new Softex(this.frame,this.ground,this.physics);this.group.add(this.softex.group);
    this.xalqlar=new XalqlarDostligi(this.frame,this.ground,this.physics);this.group.add(this.xalqlar.group);
    // Ariq o'yinchining suv zonalariga qo'shiladi: mashina undan sayoz
    // kechib o'tadi, chuqurroq havzalarda esa cho'kadi.
    this.ground.water.addZone(this.softex.drainRing,this.softex.drainLevel);
    // Landmarklarning minglab mayda kolliderlari bitta trimesh'ga — `Physics.bakeStaticColliders`.
    this.physics.bakeStaticColliders();
    // Yengil rejim: relyef va landmarklar arzon materialga (tayllar `loadTile` da).
    for (const object of [this.ground.mesh, this.lake?.group, this.hokimiyat.group, this.farxod.group, this.softex.group, this.xalqlar.group]) if (object) liteMaterials(object);
    this.ready = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  update = (ctx: FrameContext): void => {
    if (this.disposed || !this.ready || !this.player || !this.physics) return;

    if (!this.paused && !this.teleporting) {
      this.physics.step(ctx.dt, (dt) => {
        this.player!.update(dt);
        this.traffic?.update(dt, this.player!.state);
      });
    }
    this.player.render();
    this.traffic?.render();

    // Quyosh o'yinchi bilan birga ko'chadi. Yo'naltirilgan chiroqning o'zi
    // cheksiz uzoqda bo'lsa ham, uning SOYA KAMERASI cheklangan maydonni
    // qamraydi — shuning uchun u doim o'yinchi ustida turishi kerak.
    // Osmon, soyalar va ko'cha chiroqlari — hammasi bitta lahzadan.
    const position = this.player.state.position;
    if (this.frame) {
      const { lat, lon } = this.frame.origin;
      this.currentSky = this.sky.update(this.clock.now(), lat, lon, position);
      setStreetLightLevel(1 - this.currentSky.daylight);
      this.lake?.update(this.paused?0:ctx.dt,1-this.currentSky.daylight,position);
      this.hokimiyat?.update(this.paused?0:ctx.dt,1-this.currentSky.daylight);
      this.farxod?.update(this.paused?0:ctx.dt,1-this.currentSky.daylight);
      this.xalqlar?.update(this.paused?0:ctx.dt,1-this.currentSky.daylight);
    }

    this.cullTiles(position);

    this.selectTimer += ctx.dt;
    if (this.selectTimer >= 1 / SELECT_HZ && !this.teleporting) {
      this.selectTimer = 0;
      void this.select(false);
    }
  };

  /**
   * Yengil rejimda uzoqdagi tayllar chizilmaydi. Tayl meshi butun 2 km lik
   * taylni bitta chizish chaqiruvida qoplaydi, shuning uchun kamera frustumi
   * uni hech qachon o'zi kesmaydi — masofani qo'lda tekshiramiz. Fizika va
   * mini-xarita ma'lumoti joyida qoladi.
   */
  private cullTiles(position: { x: number; z: number }): void {
    if (!Number.isFinite(QUALITY.tileViewDistance)) return;
    for (const tile of this.tiles.values()) {
      const b = tile.bounds;
      const dx = Math.max(b.minX - position.x, 0, position.x - b.maxX);
      const dz = Math.max(b.minZ - position.z, 0, position.z - b.maxZ);
      tile.group.visible = Math.hypot(dx, dz) < QUALITY.tileViewDistance;
    }
  }

  /** Osmonning hozirgi holati — HUD soati shundan o'qiydi. */
  get skyState(): SkyState | null {
    return this.currentSky;
  }

  get playerState(): PlayerState | null {
    return this.player?.state ?? null;
  }

  /**
   * Butun shahar xaritasi — bir marta quriladi va keshlanadi.
   * Qurish barcha 191 taylni o'qishni talab qiladi, shuning uchun u faqat
   * foydalanuvchi xaritani birinchi marta ochganda bajariladi.
   */
  async overview(): Promise<CityOverview | null> {
    if (this.overviewCache) return this.overviewCache;
    if (!this.frame) return null;
    const extras=[...(this.lake?[this.lake.map]:[]),...(this.hokimiyat?[this.hokimiyat.map]:[]),...(this.farxod?[this.farxod.map]:[]),...(this.softex?[this.softex.map]:[]),...(this.xalqlar?[this.xalqlar.map]:[])];
    this.overviewPromise ??= buildCityOverview(this.osm, this.frame,undefined,extras).then((result) => {
      this.overviewCache = result;
      return result;
    });
    return this.overviewPromise;
  }

  /** O'yinchini xaritada belgilangan nuqtaga ko'chiradi. */
  async teleport(x: number, z: number): Promise<void> {
    if (!this.player || !this.ground || this.teleporting || !Number.isFinite(x + z)) return;
    this.teleporting = true;
    try {
      const b = this.ground.bounds;
      const requested = new Vector3(Math.max(b.minX + 20, Math.min(b.maxX - 20, x)), 0,
        Math.max(b.minZ + 20, Math.min(b.maxZ - 20, z)));
      const safe = await this.findRoadSpawn(requested);
      if (!safe) throw new Error('Bu hududda xavfsiz yo‘l topilmadi. Boshqa nuqtani belgilang.');
      await this.select(true, safe);
      if (this.disposed) return;
      if (this.player.water.contains(safe, 3) || (this.carSpawn && this.player.water.contains(this.carSpawn, 3))) {
        throw new Error('Bu joy suv qirg‘og‘iga juda yaqin. Quruqlikdagi boshqa ko‘chani tanlang.');
      }
      this.traffic?.reset();
      this.physics?.world.updateSceneQueries();
      this.player.teleport(safe.x, safe.z, this.carSpawn ?? undefined);
      this.updateStats();
    } catch (error) {
      this.onError?.((error as Error).message);
    } finally {
      this.teleporting = false;
    }
  }

  /** 3D dunyodagi metka ustuni. `null` bersa — o'chiriladi. */
  setWaypoint(point: { x: number; z: number } | null): void {
    if (!point || !this.ground) {
      if (this.waypointMesh) {
        this.group.remove(this.waypointMesh);
        this.waypointMesh.geometry.dispose();
        (this.waypointMesh.material as MeshBasicMaterial).dispose();
        this.waypointMesh = null;
      }
      return;
    }

    if (!this.waypointMesh) {
      // Baland va yarim shaffof ustun: uzoqdan ham ko'rinadi, lekin
      // ko'rinishni to'sib qo'ymaydi.
      const geometry = new CylinderGeometry(1.6, 1.6, WAYPOINT_HEIGHT, 12, 1, true);
      geometry.translate(0, WAYPOINT_HEIGHT / 2, 0);
      this.waypointMesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: 0xffd166,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: DoubleSide,
          fog: false,
        }),
      );
      this.waypointMesh.renderOrder = 2;
      this.group.add(this.waypointMesh);
    }
    this.waypointMesh.position.set(point.x, this.ground.heightAt(point.x, point.z), point.z);
  }

  /** Mini-xarita uchun: yuklangan tayllarning 2D konturlari. */
  *mapTiles(): Iterable<CityMapData> {
    if(this.lake)yield this.lake.map;
    if(this.hokimiyat)yield this.hokimiyat.map;
    if(this.farxod)yield this.farxod.map;
    if(this.softex)yield this.softex.map;
    for (const tile of this.tiles.values()) yield tile.map;
  }

  /** O'yinchi atrofidagi tayllarni yuklaydi va keraksizlarini bo'shatadi. */
  private async select(waitForAll: boolean, target?: Vector3): Promise<void> {
    const zoom = this.osm.zoom;
    if (zoom === null || !this.frame || !this.player) return;

    const position = target ?? this.player.state.position;
    const lla = this.frame.toLla(position);
    const center = lonLatToTile(lla.lon, lla.lat, zoom);

    const wanted = new Set<string>();
    this.wantedTiles = wanted;
    const jobs: Promise<void>[] = [];

    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      for (let dy = -RENDER_RADIUS; dy <= RENDER_RADIUS; dy++) {
        const coord: TileCoord = { z: zoom, x: center.x + dx, y: center.y + dy };
        if (!this.osm.has(coord)) continue;
        const key = tileKey(coord);
        wanted.add(key);
        if (!this.tiles.has(key) && !this.loading.has(key)) {
          this.loading.add(key);
          const job = this.loadTile(key, coord);
          this.loadJobs.set(key, job);
          jobs.push(job);
        } else if (this.loadJobs.has(key)) {
          jobs.push(this.loadJobs.get(key)!);
        }
      }
    }

    for (const [key, tile] of this.tiles) {
      if (wanted.has(key)) continue;
      this.group.remove(tile.group);
      tile.dispose();
      this.tiles.delete(key);
      this.mapsDirty = true;
      this.physics?.removeTileWalls(key);
      this.physicsTiles.delete(key);
    }

    if (waitForAll) await Promise.all(jobs);
    for(const tile of this.tiles.values())tile.updateDetails(position);

    this.updatePhysicsTiles(center, zoom);
    if (this.mapsDirty) {
      this.traffic?.setMaps(this.mapTiles());
      this.mapsDirty = false;
    }
    this.updateStats();
  }

  /** Mashina qo'yiladigan nuqta — `findRoadSpawn` uni ham hisoblaydi. */
  private carSpawn: Vector3 | null = null;

  /**
   * Markazga eng yaqin haydaladigan yo'l nuqtasini topadi.
   *
   * Piyoda yo'lak va so'qmoqlar hisobga olinmaydi: mashina ham shu yerda
   * paydo bo'lishi kerak, ya'ni nuqta haqiqiy ko'chada bo'lsin.
   */
  private async findRoadSpawn(center: Vector3, mainStreet = false): Promise<Vector3 | null> {
    const zoom = this.osm.zoom;
    if (zoom === null || !this.frame) return null;

    const lla = this.frame.toLla(center);
    const tile = lonLatToTile(lla.lon, lla.lat, zoom);
    const data = await this.osm.get(tile);
    if (!data) return null;

    const drivable = new Set([
      'residential', 'living_street', 'unclassified', 'tertiary',
      'secondary', 'primary', 'trunk', 'service',
    ]);

    let best: Vector3 | null = null;
    let bestNext: Vector3 | null = null;
    let bestDistance = Infinity;
    const point = new Vector3();
    const next = new Vector3();

    for (const road of data.roads) {
      if (!drivable.has(road.c) || road.b || road.t) continue;
      if (mainStreet && !['primary', 'secondary', 'tertiary', 'residential'].includes(road.c)) continue;
      const count = road.p.length / 2;
      for (let i = 0; i < count - 1; i++) {
        this.tileToLocal(tile, data.extent, road.p[i * 2]!, road.p[i * 2 + 1]!, point);
        this.tileToLocal(tile, data.extent, road.p[i * 2 + 2]!, road.p[i * 2 + 3]!, next);
        const dx = next.x - point.x, dz = next.z - point.z;
        const t = Math.max(0, Math.min(1, ((center.x - point.x) * dx + (center.z - point.z) * dz) / (dx * dx + dz * dz || 1)));
        point.x += dx * t;
        point.z += dz * t;
        const distance = Math.hypot(point.x - center.x, point.z - center.z);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = point.clone();
        bestNext = point.clone().add(new Vector3(dx, 0, dz));
      }
    }

    if (best && bestNext) {
      // Mashina o'sha ko'chada, o'yinchidan bir necha metr narida tursin.
      const dx = bestNext.x - best.x;
      const dz = bestNext.z - best.z;
      const length = Math.hypot(dx, dz) || 1;
      this.carSpawn = new Vector3(best.x + (dx / length) * 5.5, 0, best.z + (dz / length) * 5.5);
    }
    return best;
  }

  private tileToLocal(
    tile: TileCoord,
    extent: number,
    qx: number,
    qy: number,
    out: Vector3,
  ): void {
    const { lat, lon } = tileUvToLonLat(tile, qx / extent, qy / extent);
    this.frame!.toLocal({ lat, lon, alt: 0 }, out);
  }

  private async loadTile(key: string, coord: TileCoord): Promise<void> {
    try {
      const data = await this.osm.get(coord);
      if (this.disposed || !this.wantedTiles.has(key) || !data || !this.frame || !this.ground) return;
      const tile = new CityTile(coord, data, this.frame, this.ground);
      liteMaterials(tile.group, true);
      this.tiles.set(key, tile);
      this.group.add(tile.group);
      this.mapsDirty = true;
    } catch (error) {
      this.onError?.(`${key}: ${(error as Error).message}`);
    } finally {
      this.loading.delete(key);
      this.loadJobs.delete(key);
    }
  }

  /**
   * Fizika collideri faqat eng yaqin tayllar uchun quriladi.
   *
   * Trimesh collider qurish qimmat va u xotirada joy egallaydi; o'yinchi
   * 2 km narida turgan binoga baribir urila olmaydi.
   */
  private updatePhysicsTiles(center: TileCoord, zoom: number): void {
    if (!this.physics) return;

    const wanted = new Set<string>();
    for (let dx = -PHYSICS_RADIUS; dx <= PHYSICS_RADIUS; dx++) {
      for (let dy = -PHYSICS_RADIUS; dy <= PHYSICS_RADIUS; dy++) {
        wanted.add(tileKey({ z: zoom, x: center.x + dx, y: center.y + dy }));
      }
    }

    for (const key of this.physicsTiles) {
      if (wanted.has(key)) continue;
      this.physics.removeTileWalls(key);
      this.physicsTiles.delete(key);
    }

    for (const key of wanted) {
      if (this.physicsTiles.has(key)) continue;
      const tile = this.tiles.get(key);
      if (!tile?.wallPositions) continue;
      this.physics.addTileWalls(key, tile.wallPositions);
      this.physicsTiles.add(key);
    }
  }

  private updateStats(): void {
    let buildings = 0;
    let triangles = 0;
    for (const tile of this.tiles.values()) {
      buildings += tile.stats.buildings;
      triangles += tile.stats.triangles;
    }
    this.stats = {
      tiles: this.tiles.size,
      buildings,
      triangles,
      physicsTiles: this.physicsTiles.size,
      loading: this.loading.size,
      ...(this.traffic?.counts ?? { cars: 0, people: 0 }),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.traffic?.dispose();
    this.parked?.dispose();
    this.player?.dispose();
    this.lake?.dispose();
    this.hokimiyat?.dispose();
    this.farxod?.dispose();
    this.softex?.dispose();
    this.xalqlar?.dispose();
    for (const tile of this.tiles.values()) tile.dispose();
    this.tiles.clear();
    this.setWaypoint(null);
    this.ground?.dispose();
    this.physics?.dispose();
    this.osm.dispose();
    this.terrain.dispose();

    const { scene } = this.engine;
    scene.remove(this.group);
    scene.background = null;
    this.sky.dispose();
  }
}
