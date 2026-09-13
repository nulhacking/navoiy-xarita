import {
  AnimationMixer,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type AnimationAction,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';

import type { Ground } from './Ground.ts';
import type { WaterZones } from './WaterZones.ts';
import { alignCharacterFeet, type LoadedModel } from './models.ts';
import type { Input } from './Input.ts';
import { RAPIER, type Physics } from './Physics.ts';
import { angleDifference, approach, yawRate } from './VehicleMotion.ts';
import { animateVehicle } from './VehicleRig.ts';
import { vehicleSpec, VEHICLE_SPECS } from './FleetAssets.ts';
import { Rider } from './Rider.ts';

const WALK_SPEED = 4.2;
const RUN_SPEED = 9;
const JUMP_SPEED = 5.2;
const GRAVITY = -9.81;

/**
 * Suv: kechish va suzish.
 *
 * `SWIM_DEPTH` — oyoq yerdan uzilib, gavda suzib qoladigan chuqurlik. 1.8 m
 * bo'yli personaj uchun bu ko'krak sathi: undan pastda oyoq tubga tegib
 * turadi (kechish), balandda esa suzish boshlanadi.
 *
 * `SWIM_FLOAT` — suzayotganda suv sathidan oyoqqacha bo'lgan masofa, ya'ni
 * bosh va yelka suvdan tashqarida qoladi.
 */
const SWIM_DEPTH = 1.3;
// SWIM_FLOAT ataylab SWIM_DEPTH dan KATTA: muvozanat holati suzish
// oralig'ining ICHIDA bo'lishi kerak, aks holda gavda chegarada 'suzaman —
// suzmayman' deb titrab qoladi. 1.45 m da bo'y 1.8 m personajning boshi va
// yelkasi suvdan tashqarida.
const SWIM_FLOAT = 1.45;
const SWIM_SPEED = 2.1;
/** Suzish sathiga qaytish qattiqligi, 1/s. Kattasi — suvda sakragandek. */
const BUOYANCY = 3.5;

const CAPSULE_RADIUS = 0.35;
/** Kapsulaning silindr qismi yarim balandligi. To'liq bo'y ≈ 1.8 m. */
const CAPSULE_HALF = 0.55;

const CAR_HALF = { x: 0.95, y: 0.7, z: 2.25 };
const CAR_REVERSE_SPEED = 12;
const CAR_DRAG = 0.3;

/**
 * Transport va suv.
 *
 * Avval suv transport uchun QATTIQ devor edi: `movementFraction` qirg'oqda
 * tezlikni nolga tushirardi. Endi mashina suvga kiraveradi va chuqurlikka
 * qarab uch bosqichdan o'tadi.
 *
 * `CAR_WADE_DEPTH` — g'ildirak o'qi sathi. Bundan sayozroq joyda mashina
 * yuraveradi, faqat sekinlashadi va boshqaruvi og'irlashadi.
 *
 * `CAR_DROWN_DEPTH` — havo oluvchi teshik sathi: bundan chuqurda motor o'chadi.
 * Shundan keyin gavda suzadi, lekin salon asta-sekin suvga to'ladi
 * (`CAR_FLOOD_TIME`), cho'kish chuqurligi ortadi va oxirida mashina TUBGA
 * o'tiradi. Sayozga qaytib chiqsa suv quyilib, motor yana ishga tushadi.
 */
const CAR_WADE_DEPTH = 0.55;
const CAR_DROWN_DEPTH = 0.95;
const CAR_FLOOD_TIME = 7;
/** Bo'sh gavda suv ostida qolgan ulushi. To'lgani sari ortadi. */
const CAR_DRAFT = 0.34;
/** Suzish sathiga qaytish qattiqligi, 1/s. */
const CAR_BUOYANCY = 2.6;
/** Eng katta burilish tezligi, rad/s. Tezlik oshgani sari kamayadi. */

export type PlayerMode = 'walk' | 'drive';
export interface VehicleClaim { position: Vector3; yaw: number; speed: number; object?: Object3D }

export interface PlayerState {
  mode: PlayerMode;
  /** km/soat — HUD uchun. */
  speed: number;
  position: Vector3;
  grounded: boolean;
  nearCar: boolean;
  /**
   * Mini-xaritani aylantirish burchagi, radian.
   *
   * Shunday tanlanganki, `ctx.rotate(heading)` dan keyin o'yinchi qaragan
   * dunyo yo'nalishi ekranda YUQORIGA qaraydi. Piyoda va mashina uchun
   * "oldinga" ta'rifi teskari (kamera o'z -Z bo'ylab qaraydi, mashina esa
   * +Z bo'ylab yuradi), shuning uchun mashinada π qo'shiladi.
   */
  heading: number;
  /** Mashinaning joyi — mini-xaritada belgi qo'yish uchun. */
  carPosition: Vector3;
  vehicleLabel: string;
  /** Suvda: 0 — quruqlikda, 1 — kechyapti, 2 — suzyapti. */
  water: 0 | 1 | 2;
}

/**
 * O'yinchi: piyoda yurish va mashina haydash.
 *
 * Ikkalasi ham Rapier'ning KINEMATIK personaj kontrolleridan foydalanadi.
 * Mashina uchun to'liq raycast-suspenziyali dinamik model ham bor edi, lekin
 * arkada modeli ataylab tanlandi: GTA ham simulyator emas, va kinematik
 * yondashuvda mashina binoga urilib ag'darilib ketmaydi yoki devor ichiga
 * o'tib ketmaydi — boshqarish barqaror va bashorat qilinadigan bo'ladi.
 */
export class Player {
  readonly group = new Group();
  /** Shahar suvi — relyef bilan bitta manbadan (Ground). */
  get water(): WaterZones { return this.ground.water; }
  readonly camera: PerspectiveCamera;

  private readonly physics: Physics;
  private readonly ground: Ground;
  private readonly input: Input;
  private readonly trafficVehicleDistance: ((position: Vector3, radius: number) => number | null) | undefined;
  private readonly claimTrafficVehicle: ((position: Vector3, radius: number) => VehicleClaim | null) | undefined;
  private readonly releaseVehicle: ((vehicle: VehicleClaim) => void) | undefined;
  private rider: Rider | null = null;

  private readonly avatar: Object3D;
  private car: Object3D;
  private carFootOffset: number;
  private spec = VEHICLE_SPECS[0]!;
  /** Personaj animatsiyasi (model yuklangan bo'lsa). */
  private mixer: AnimationMixer | null = null;
  private walkAction: AnimationAction | null = null;
  private idleAction: AnimationAction | null = null;
  private runAction: AnimationAction | null = null;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;

  private readonly carBody: RAPIER.RigidBody;
  private readonly carCollider: RAPIER.Collider;
  private readonly carController: RAPIER.KinematicCharacterController;

  private mode: PlayerMode = 'walk';
  private verticalSpeed = 0;
  private grounded = false;
  /** Oyoq suv sathidan qancha pastda, metr. Quruqlikda 0. */
  private submersion = 0;
  private carGrounded = false;

  /** Avatar qaragan yo'nalish — kameradan mustaqil, yumshoq ergashadi. */
  private facing = 0;
  /** Turish→yurish va yurish→yugurish aralashuvi, 0..1. */
  private moveBlend = 0;
  private runBlend = 0;

  /** Kamera burchagi: yaw = gorizontal, pitch = vertikal. */
  private yaw = 0;
  // Biroz yuqoridan qarash — GTA'dagi kabi: o'yinchi ham, oldidagi ko'cha ham ko'rinsin.
  private pitch = -0.34;
  private cameraDistance = 7.5;

  private carSpeed = 0;
  private carYaw = 0;
  private steering = 0;
  /** Mashinaning vertikal tezligi — piyodadagi kabi haqiqiy gravitatsiya. */
  private carVerticalSpeed = 0;
  /** Mashina ostidagi suv chuqurligi, metr. Quruqlikda 0. */
  private carDepth = 0;
  /** Salonning suvga to'lishi, 0..1. 1 da mashina suzmaydi — tubda yotadi. */
  private carFlood = 0;
  /** Suzayotganda yerga yopishtirishni o'chirib qo'yish uchun. */
  private carSnapping = true;
  private carPosition = new Vector3();

  private readonly scratch = new Vector3();
  private readonly cameraTarget = new Vector3();

  constructor(options: {
    physics: Physics;
    ground: Ground;
    input: Input;
    camera: PerspectiveCamera;
    spawn: Vector3;
    /** Mashina qayerda turadi. Berilmasa o'yinchidan bir necha metr sharqda. */
    carSpawn?: Vector3;
    /** Tayyor modellar. Yuklanmasa oddiy shakllar ishlatiladi. */
    characterModel?: LoadedModel;
    vehicleModel?: LoadedModel;
    trafficVehicleDistance?: (position: Vector3, radius: number) => number | null;
    claimTrafficVehicle?: (position: Vector3, radius: number) => VehicleClaim | null;
    releaseVehicle?: (vehicle: VehicleClaim) => void;
  }) {
    this.physics = options.physics;
    this.ground = options.ground;
    this.input = options.input;
    this.trafficVehicleDistance = options.trafficVehicleDistance;
    this.claimTrafficVehicle = options.claimTrafficVehicle;
    this.releaseVehicle = options.releaseVehicle;
    this.camera = options.camera;

    const { world } = options.physics;
    const spawnY = options.ground.heightAt(options.spawn.x, options.spawn.z) + 1.2;

    // --- Piyoda ---
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        options.spawn.x,
        spawnY,
        options.spawn.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS),
      this.body,
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    // Trotuar qirrasi va zinapoyaga qoqilib qolmaslik uchun.
    this.controller.enableAutostep(0.5, 0.2, true);
    // Kichik nishabliklarda "sakrab" ketmaslik uchun yerga yopishtirish.
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((38 * Math.PI) / 180);

    if (options.characterModel) {
      this.avatar = options.characterModel.object;
      const clips = options.characterModel.animations;
      const clip = clips.find((c) => /Walk$/i.test(c.name)) ?? clips[0];
      if (clip) {
        this.mixer = new AnimationMixer(this.avatar);
        this.walkAction = this.mixer.clipAction(clip);
        this.walkAction.play();
        // Turgan holatda animatsiya to'xtaydi: `timeScale` bilan boshqaramiz,
        // shunda qayta ishga tushirishda poza sakramaydi.
        this.walkAction.timeScale = 0;
        const idle = clips.find((c) => /Idle(?:_Neutral)?$/i.test(c.name));
        const run = clips.find((c) => /Run$/i.test(c.name));
        if (idle) this.idleAction = this.mixer.clipAction(idle).play();
        if (run) this.runAction = this.mixer.clipAction(run).play();
        this.walkAction.setEffectiveWeight(0);
        this.runAction?.setEffectiveWeight(0);
      }
    } else {
      // Zaxira: model yuklanmasa ham o'yin ishlashi kerak.
      const capsule = new Mesh(
        new CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF * 2, 6, 12),
        new MeshStandardMaterial({ color: 0xd6613f, roughness: 0.7 }),
      );
      capsule.castShadow = true;
      this.avatar = capsule;
    }
    this.group.add(this.avatar);

    // --- Mashina ---
    const carSpawn = options.carSpawn ?? new Vector3(options.spawn.x + 4.5, 0, options.spawn.z);
    this.carPosition.set(carSpawn.x, 0, carSpawn.z);
    if (options.carSpawn) {
      this.carYaw = Math.atan2(carSpawn.x - options.spawn.x, carSpawn.z - options.spawn.z);
      this.yaw = this.carYaw + Math.PI;
    }
    this.carPosition.y = options.ground.heightAt(this.carPosition.x, this.carPosition.z) + CAR_HALF.y;

    this.carBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.carPosition.x,
        this.carPosition.y,
        this.carPosition.z,
      ),
    );
    this.carCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(CAR_HALF.x, CAR_HALF.y, CAR_HALF.z),
      this.carBody,
    );
    this.carController = world.createCharacterController(0.02);
    this.carController.setUp({ x: 0, y: 1, z: 0 });
    this.carController.enableAutostep(0.35, 0.2, true);
    this.carController.enableSnapToGround(0.5);
    this.carController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);

    this.car = options.vehicleModel?.object ?? buildCarMesh();
    this.spec = vehicleSpec(this.car);
    // Model sport avtomobil bo'lmasligi mumkin (yengil rejimda sedan): kollayder shu transportniki.
    this.carFootOffset = options.vehicleModel ? this.spec.half.y : 0;
    if (options.vehicleModel) this.carCollider.setShape(new RAPIER.Cuboid(this.spec.half.x, this.spec.half.y, this.spec.half.z));
    this.group.add(this.car);
    if (options.characterModel) {
      this.rider = new Rider(options.characterModel);
      this.car.add(this.rider.object);
      this.rider.object.visible = false;
    }

    this.syncMeshes();
  }

  get state(): PlayerState {
    const position = this.mode === 'drive' ? this.carPosition : this.bodyPosition(this.scratch);
    return {
      mode: this.mode,
      speed: this.mode === 'drive' ? Math.abs(this.carSpeed) * 3.6 : 0,
      position: position.clone(),
      grounded: this.mode === 'drive' ? this.carGrounded : this.grounded,
      nearCar: this.isNearCar(),
      heading: this.mode === 'drive' ? this.carYaw + Math.PI : this.yaw,
      carPosition: this.carPosition.clone(),
      vehicleLabel: this.spec.label,
      water: this.mode === 'drive'
        ? (this.carFlood > 0.02 ? 2 : this.carDepth > 0.08 ? 1 : 0)
        : this.submersion <= 0 ? 0 : this.submersion >= SWIM_DEPTH ? 2 : 1,
    };
  }

  update(dt: number): void {
    this.updateCamera(dt);

    if (this.input.wasPressed('KeyF')) {
      if (this.mode === 'walk' && this.isNearCar()) {
        const position = this.bodyPosition(this.scratch);
        const ownDistance = Math.hypot(position.x-this.carPosition.x, position.z-this.carPosition.z);
        const trafficDistance = this.trafficVehicleDistance?.(position, 7) ?? null;
        // F har safar eng yaqin mashinani oladi. O'z mashinangiz faqat NPC
        // mashinasi undan yaqinroq bo'lmasa tanlanadi.
        if (trafficDistance !== null && trafficDistance < ownDistance) {
          const claimed = this.claimTrafficVehicle?.(this.bodyPosition(this.scratch), 7);
          if (claimed) this.adoptVehicle(claimed);
          else return;
        }
        this.enterCar();
      }
      else if (this.mode === 'drive') this.exitCar();
    }

    if (this.mode === 'walk') this.updateWalk(dt);
    this.updateDrive(dt);
  }

  render(): void {
    const t = this.carBody.translation();
    this.carPosition.set(t.x, t.y, t.z);
    this.syncMeshes();
    this.placeCamera();
  }

  private updateCamera(dt: number): void {
    const delta = this.input.takeMouseDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      this.yaw -= delta.x * 0.0022;
      this.pitch -= delta.y * 0.0018;
      // Kamera tik yuqoriga yoki pastga aylanib ketmasin.
      this.pitch = Math.min(Math.max(this.pitch, -1.15), 0.55);
    }

    const wheel = this.input.takeWheelDelta();
    if (wheel !== 0) {
      this.cameraDistance = Math.min(Math.max(this.cameraDistance + wheel * 0.01, 2.5), 14);
    }
    if (this.input.isDown('KeyC') && this.mode === 'drive') {
      const target = this.carYaw + Math.PI;
      const difference = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
      this.yaw += difference * (1 - Math.exp(-2.5 * dt));
    }
  }

  private updateWalk(dt: number): void {
    const axis = this.input.moveAxis();
    const speed = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? RUN_SPEED : WALK_SPEED;

    // Harakat kamera yo'nalishiga nisbatan.
    //
    // Kamera nishondan `(sin(yaw), *, cos(yaw))` siljishda turadi, ya'ni u
    // nishonga `-(sin, cos)` yo'nalishida qaraydi. Demak "oldinga" (W) —
    // aynan shu vektor, kameradan UZOQLASHISH tomoni.
    //   oldinga = (-sin,  0, -cos)
    //   o'ngga  = ( cos,  0, -sin)   [oldinga x yuqori]
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const moveX = (axis.x * cos - axis.y * sin) * speed;
    const moveZ = (-axis.x * sin - axis.y * cos) * speed;

    // Suvda sakrab bo'lmaydi: chuqurlikda tayanch yo'q.
    const jump = this.input.wasPressed('Space') && this.submersion < 0.6;
    if (this.grounded) {
      this.verticalSpeed = jump ? JUMP_SPEED : -0.5;
    } else {
      this.verticalSpeed += GRAVITY * dt;
      // Tushish tezligini cheklaymiz — aks holda uzoq yiqilishda kollizyon
      // bir kadrda o'tkazib yuborilishi mumkin.
      this.verticalSpeed = Math.max(this.verticalSpeed, -55);
    }

    const start = this.body.translation();
    // Piyoda suvga kiraveradi — to'siq faqat transport uchun. Chuqurlashgan
    // sari yurish sekinlashadi, ko'krakdan oshganda suzishga o'tadi.
    const level = this.ground.waterLevelAt(start.x, start.z);
    this.submersion = level === null ? 0 : Math.max(0, level - (start.y - CAPSULE_HALF - CAPSULE_RADIUS));
    const swimming = this.submersion >= SWIM_DEPTH;
    const drag = swimming
      ? SWIM_SPEED / speed
      : 1 - 0.5 * Math.min(1, this.submersion / SWIM_DEPTH);

    if (swimming && level !== null) {
      // Suzish: gravitatsiya o'rniga suzish kuchi. Nishon — gavdaning suv
      // sathidagi muvozanat holati; kapsula markazi oyoqdan yuqorida.
      const target = level - SWIM_FLOAT + CAPSULE_HALF + CAPSULE_RADIUS;
      this.verticalSpeed = Math.max(-3, Math.min(3, (target - start.y) * BUOYANCY));
    }

    this.controller.computeColliderMovement(this.collider, {
      x: moveX * dt * drag,
      y: this.verticalSpeed * dt,
      z: moveZ * dt * drag,
    });
    const movement = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const position = this.bodyPosition(this.scratch);
    position.add(new Vector3(movement.x, movement.y, movement.z));
    this.clampToCity(position, 1);
    this.body.setNextKinematicTranslation(position);

    // Yurayotgan tomonga qarab turishi uchun avatarni buramiz. Burilish
    // BIRDANIGA emas: ilgari `rotation.y` to'g'ridan-to'g'ri qo'yilardi va
    // A/D bosilganda personaj bir kadrda 90° ga o'girilib qolardi.
    const actualSpeed = Math.hypot(movement.x, movement.z) / Math.max(dt, 1e-6);
    const moving = actualSpeed > 0.08;
    if (moving) {
      this.facing += angleDifference(Math.atan2(moveX, moveZ), this.facing) * (1 - Math.exp(-16 * dt));
      this.avatar.rotation.y = this.facing;
    }

    if (this.mixer && this.walkAction) {
      // Uch klip (turish · yurish · yugurish) ORALIQ og'irlik bilan
      // aralashadi. Avval og'irliklar 0/1 ga sakrardi: Shift bosilgan
      // lahzada poza "chirt" etib almashardi. Endi aralashish tezlikka
      // bog'liq va vaqt bo'yicha yumshatilgan.
      const swimming = this.submersion >= SWIM_DEPTH;
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const RUN_FROM = WALK_SPEED * 0.9;
      this.moveBlend = approach(this.moveBlend, clamp(actualSpeed / 1.1), 6, dt);
      this.runBlend = approach(this.runBlend, clamp((actualSpeed - RUN_FROM) / (RUN_SPEED - RUN_FROM)), 4, dt);
      const run = this.runAction ? this.runBlend : 0;
      // Turish klipi bo'lmasa yurish klipi hech qachon nolga tushmaydi —
      // aks holda personaj to'xtaganda bog'lanish pozasiga (T) qaytib qolardi.
      this.walkAction.setEffectiveWeight(this.idleAction ? this.moveBlend * (1 - run) : 1 - run);
      this.idleAction?.setEffectiveWeight(1 - this.moveBlend);
      this.runAction?.setEffectiveWeight(this.moveBlend * run);
      // Qadam uzunligi tezlikka bog'lanadi — aks holda "muzda sirg'alish"
      // effekti chiqadi. Bo'linuvchi — klipning o'z qadam tezligi.
      this.walkAction.timeScale = moving ? actualSpeed / (swimming ? 0.9 : 1.4) : 0;
      if (this.runAction) this.runAction.timeScale = moving ? actualSpeed / 5.5 : 0;
      this.mixer.update(dt);
    }
  }

  private updateDrive(dt: number): void {
    const axis = this.mode === 'drive' ? this.input.moveAxis() : { x: 0, y: 0 };
    const current = this.carBody.translation();
    this.carPosition.set(current.x, current.y, current.z);

    // --- Suv ---
    // Chuqurlik TUBDAN o'lchanadi, mashina gavdasidan emas: suzib turgan
    // mashinada gavda sathi o'zgaraveradi va o'lchov o'z-o'ziga qaytib,
    // mashina "chiqdi — cho'kdi" deb titrab qolardi.
    const bed = this.ground.heightAt(current.x, current.z);
    const level = this.ground.waterLevelAt(current.x, current.z);
    this.carDepth = level === null ? 0 : Math.max(0, level - bed);
    const wading = Math.min(1, this.carDepth / CAR_WADE_DEPTH);
    this.carFlood = this.carDepth >= CAR_DROWN_DEPTH
      ? Math.min(1, this.carFlood + dt / CAR_FLOOD_TIME)
      // Sayozga chiqqach suv quyiladi — bu to'lishdan ancha tez.
      : Math.max(0, this.carFlood - dt / 2.5);
    const drowned = this.carFlood > 0.02;
    const floating = level !== null && this.carDepth > CAR_WADE_DEPTH;

    // Gaz va tormoz. Suvda kuch ham, eng katta tezlik ham kamayadi; motor
    // suvga to'lganda esa umuman ishlamaydi.
    const power = drowned ? 0 : 1 - 0.55 * wading;
    if (axis.y > 0) this.carSpeed += this.spec.acceleration * power * dt;
    else if (axis.y < 0) {
      this.carSpeed -= (this.carSpeed > 0 ? this.spec.brake : this.spec.acceleration * power) * dt;
    } else {
      // Bo'sh yurishda sekin so'nadi.
      this.carSpeed = approach(this.carSpeed, 0, CAR_DRAG + 0.008 * this.carSpeed ** 2, dt);
    }
    // Suv qarshiligi: kechganda sezilarli, suzganda mashinani tez to'xtatadi.
    if (this.carDepth > 0.05) this.carSpeed = approach(this.carSpeed, 0, 2.5 * wading + (drowned ? 5 : 0), dt);
    const topSpeed = this.spec.maxSpeed * (drowned ? 0.25 : 1 - 0.5 * wading);
    this.carSpeed = Math.min(Math.max(this.carSpeed, this.spec.kind==='car'?-CAR_REVERSE_SPEED:-2), topSpeed);
    if (this.mode === 'drive' && this.input.isDown('Space')) {
      this.carSpeed = approach(this.carSpeed, 0, 12, dt);
    }

    // Burilish faqat harakatda ishlaydi va yuqori tezlikda kamayadi —
    // shu ikki qoida arkada boshqaruvni "og'ir" va bashoratli qiladi.
    // Suvda g'ildirak yerga tayanmaydi, shuning uchun burilish ham susayadi.
    const steeringLimit = 0.55 / (1 + Math.abs(this.carSpeed) / 24) * (1 - 0.55 * wading);
    this.steering = approach(this.steering, -axis.x * steeringLimit, 1.6, dt);
    this.carYaw += yawRate(this.carSpeed, this.steering) * dt;
    this.carBody.setRotation({ x: 0, y: Math.sin(this.carYaw / 2), z: 0, w: Math.cos(this.carYaw / 2) }, true);
    this.physics.world.updateSceneQueries();

    const forwardX = Math.sin(this.carYaw);
    const forwardZ = Math.cos(this.carYaw);

    if (floating && level !== null) {
      // Suzish: bo'sh gavda suv yuzasidagi muvozanat sathiga tortiladi.
      // Salon to'lgani sari suzish kuchi yo'qoladi va prujina o'rniga sekin,
      // bir tekis CHO'KISH qoladi — mashina qanchalik chuqur bo'lsa ham
      // tubga tushadi va kontroller uni o'sha yerda ushlab qoladi.
      const draft = this.spec.half.y * 2 * (CAR_DRAFT + 0.9 * this.carFlood);
      const target = level - draft + this.spec.half.y;
      const buoyant = Math.max(0, 1 - this.carFlood / 0.85);
      this.carVerticalSpeed = Math.max(-2.5, Math.min(2.5,
        (target - current.y) * CAR_BUOYANCY * buoyant - 0.9 * (1 - buoyant)));
    } else if (this.carGrounded) {
      // Gravitatsiya piyodadagi bilan bir xil. Avval bu yerda o'zgarmas
      // `-6 m/s` bosim bor edi: mashina qiyalikdan tushganda yerdan uzilib,
      // keyin sekin "cho'kib" tushardi. Endi u haqiqatan yiqiladi.
      this.carVerticalSpeed = -1;
    } else {
      this.carVerticalSpeed += GRAVITY * dt;
      this.carVerticalSpeed = Math.max(this.carVerticalSpeed, -55);
    }
    // Yerga yopishtirish suzayotgan gavdani har qadamda pastga tortadi —
    // suvda uni o'chiramiz.
    if (floating === this.carSnapping) {
      this.carSnapping = !floating;
      if (floating) this.carController.disableSnapToGround();
      else this.carController.enableSnapToGround(0.5);
    }

    const desired = {
      x: forwardX * this.carSpeed * dt,
      y: this.carVerticalSpeed * dt,
      z: forwardZ * this.carSpeed * dt,
    };

    this.carController.computeColliderMovement(this.carCollider, desired);
    const movement = this.carController.computedMovement();
    this.carGrounded = this.carController.computedGrounded();

    const before = { x: this.carPosition.x, z: this.carPosition.z };
    this.carPosition.add(new Vector3(movement.x, movement.y, movement.z));
    this.clampToCity(this.carPosition, 3);
    this.carBody.setNextKinematicTranslation(this.carPosition);

    // To'siqqa urilganda tezlikni yo'qotamiz: haqiqiy siljish so'ralganidan
    // sezilarli kichik bo'lsa, demak devorga tegdik.
    const actual = Math.hypot(this.carPosition.x - before.x, this.carPosition.z - before.z);
    animateVehicle(this.car, (this.carPosition.x - before.x) * forwardX + (this.carPosition.z - before.z) * forwardZ, this.steering);
    if(this.mode==='drive')this.rider?.pose(this.spec,actual*Math.sign(this.carSpeed),this.steering);
    const requested = Math.abs(this.carSpeed * dt);
    if (requested > 0.01 && actual < requested * 0.5) this.carSpeed *= 0.25;
  }

  /**
   * Mashinadan tushish.
   *
   * Ikki yon va orqa tekshiriladi; devor ichiga tushishga ruxsat yo'q.
   * Avval QURUQ joy qidiriladi, topilmasa suvga ham tushiladi — aks holda
   * ko'l o'rtasida cho'kkan mashinada o'yinchi butunlay qamalib qolardi.
   * Piyoda suzishni biladi, shuning uchun suv chiqish yo'lini to'smasligi kerak.
   */
  private exitCar(): void {
    const clearance = this.spec.half.x + .9;
    const sides: Array<[number, number]> = [[clearance, 0], [-clearance, 0], [0, -this.spec.half.z - 1]];
    for (const dry of [true, false]) {
      for (const [side, behind] of sides) {
        const x = this.carPosition.x + Math.cos(this.carYaw) * side + Math.sin(this.carYaw) * behind;
        const z = this.carPosition.z - Math.sin(this.carYaw) * side + Math.cos(this.carYaw) * behind;
        if (dry && this.water.contains({ x, z }, 0.6)) continue;
        const position = { x, y: this.ground.heightAt(x, z) + CAPSULE_HALF + CAPSULE_RADIUS + 0.15, z };
        const blocked = this.physics.world.intersectionWithShape(position, { x: 0, y: 0, z: 0, w: 1 },
          new RAPIER.Capsule(CAPSULE_HALF, CAPSULE_RADIUS), undefined, undefined, this.collider);
        if (blocked) continue;
        this.mode = 'walk';
        this.carSpeed = 0;
        this.body.setEnabled(true);
        this.body.setTranslation(position, true);
        this.body.setNextKinematicTranslation(position);
        this.physics.world.updateSceneQueries();
        this.verticalSpeed = 0;
        this.grounded = false;
        return;
      }
    }
  }

  private clampToCity(position: Vector3, margin: number): void {
    const b = this.ground.bounds;
    position.x = Math.max(b.minX + margin, Math.min(b.maxX - margin, position.x));
    position.z = Math.max(b.minZ + margin, Math.min(b.maxZ - margin, position.z));
  }

  /**
   * O'yinchini (va mashinada bo'lsa, mashinani ham) berilgan nuqtaga ko'chiradi.
   * Balandlik relyefdan olinadi, tezliklar nolga tushadi.
   */
  teleport(x: number, z: number, carSpawn?: Vector3): void {
    const point = new Vector3(x, 0, z);
    this.clampToCity(point, 10);
    x = point.x;
    z = point.z;
    const y = this.ground.heightAt(x, z);
    if (this.mode === 'drive') {
      this.carPosition.set(x, y + this.spec.half.y + 0.1, z);
      this.carBody.setTranslation(this.carPosition, true);
      this.carSpeed = 0;
      this.carVerticalSpeed = 0;
    } else {
      this.body.setTranslation({ x, y: y + CAPSULE_HALF + CAPSULE_RADIUS + 0.3, z }, true);
      this.verticalSpeed = 0;
      // Mashina ham yonimizda paydo bo'lsin, aks holda u shaharning
      // narigi chekkasida qolib ketadi va boshqa foydalanib bo'lmaydi.
      const cx = carSpawn?.x ?? x + 4.5, cz = carSpawn?.z ?? z;
      this.carPosition.set(cx, this.ground.heightAt(cx, cz) + this.spec.half.y, cz);
      if (carSpawn) this.carYaw = Math.atan2(cx - x, cz - z);
      this.carBody.setTranslation(this.carPosition, true);
    }
    this.body.setNextKinematicTranslation(this.body.translation());
    this.carBody.setNextKinematicTranslation(this.carBody.translation());
    this.carSpeed = 0;
    this.carVerticalSpeed = 0;
    this.carDepth = 0;
    this.carFlood = 0;
    this.steering = 0;
    this.grounded = false;
    this.carGrounded = false;
    this.physics.world.updateSceneQueries();
    this.syncMeshes();
    this.placeCamera();
  }

  private isNearCar(): boolean {
    if (this.mode === 'drive') return true;
    const position = this.bodyPosition(this.scratch);
    return Math.hypot(position.x-this.carPosition.x,position.z-this.carPosition.z) < 7 || (this.trafficVehicleDistance?.(position, 7) ?? null) !== null;
  }

  private enterCar(): void {
    this.mode = 'drive';
    this.body.setEnabled(false);
    this.yaw = this.carYaw + Math.PI;
    this.rider?.pose(this.spec);
  }

  private adoptVehicle(vehicle: VehicleClaim): void {
    if(vehicle.object) {
      this.rider?.object.removeFromParent();
      this.releaseVehicle?.({object:this.car,position:this.carPosition.clone(),yaw:this.carYaw,speed:0});
      this.car=vehicle.object;this.spec=vehicleSpec(this.car);
      this.carFootOffset=this.spec.half.y;
      this.carCollider.setShape(new RAPIER.Cuboid(this.spec.half.x,this.spec.half.y,this.spec.half.z));
      this.group.add(this.car);
      if(this.rider)this.car.add(this.rider.object);
    }
    this.carPosition.copy(vehicle.position);
    this.carYaw = vehicle.yaw;
    this.carSpeed = vehicle.speed;
    this.carVerticalSpeed = 0;
    this.carGrounded = true;
    const rotation = { x:0, y:Math.sin(this.carYaw/2), z:0, w:Math.cos(this.carYaw/2) };
    this.carBody.setTranslation(this.carPosition, true);
    this.carBody.setNextKinematicTranslation(this.carPosition);
    this.carBody.setRotation(rotation, true);
    this.physics.world.updateSceneQueries();
  }

  private bodyPosition(out: Vector3): Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  private syncMeshes(): void {
    const t = this.body.translation();
    // Model oyog'i `y = 0` da (`models.ts` uni shunday markazlaydi), kapsula
    // esa o'z markazida — shuning uchun model kapsulaning TAGIGA qo'yiladi.
    const footOffset = this.mixer || this.avatar instanceof Group ? CAPSULE_HALF + CAPSULE_RADIUS : 0;
    this.avatar.position.set(t.x, t.y - footOffset, t.z);
    this.avatar.visible = this.mode === 'walk';
    if(this.rider)this.rider.object.visible=this.mode==='drive';
    if (this.mixer && this.avatar.visible) alignCharacterFeet(this.avatar, t.y - footOffset);

    this.car.position.copy(this.carPosition);
    this.car.position.y -= this.carFootOffset;
    this.car.rotation.y = this.carYaw;
    this.car.rotation.order = 'YXZ';
    if (this.carDepth > CAR_WADE_DEPTH) {
      // Suzayotgan gavda relyef qiyaligini takrorlamaydi — u suv yuzasida tekis yotadi.
      this.car.rotation.x = approach(this.car.rotation.x, 0, 1.2, 1 / 60);
      this.car.rotation.z = approach(this.car.rotation.z, 0, 1.2, 1 / 60);
    } else if (this.carGrounded) {
      const dx = Math.sin(this.carYaw) * 1.6, dz = Math.cos(this.carYaw) * 1.6;
      this.car.rotation.x = -Math.atan2(this.ground.heightAt(this.carPosition.x + dx, this.carPosition.z + dz)
        - this.ground.heightAt(this.carPosition.x - dx, this.carPosition.z - dz), 3.2);
      const rx = Math.cos(this.carYaw) * .8, rz = -Math.sin(this.carYaw) * .8;
      this.car.rotation.z = Math.atan2(this.ground.heightAt(this.carPosition.x + rx, this.carPosition.z + rz)
        - this.ground.heightAt(this.carPosition.x - rx, this.carPosition.z - rz), 1.6);
    }
  }

  /** Kamerani nishon ortiga qo'yadi va devorga kirib ketmasligini ta'minlaydi. */
  private placeCamera(): void {
    if (this.mode === 'drive') {
      this.cameraTarget.copy(this.carPosition).add(new Vector3(0, 1.3, 0));
    } else {
      const t = this.body.translation();
      this.cameraTarget.set(t.x, t.y + 0.8, t.z);
    }

    const distance = this.mode === 'drive' ? Math.max(this.cameraDistance, 7) : this.cameraDistance;
    const horizontal = Math.cos(this.pitch) * distance;
    const vertical = Math.sin(-this.pitch) * distance;

    const offsetX = Math.sin(this.yaw) * horizontal;
    const offsetZ = Math.cos(this.yaw) * horizontal;

    const desiredX = this.cameraTarget.x + offsetX;
    const desiredZ = this.cameraTarget.z + offsetZ;
    const desiredY = this.cameraTarget.y + vertical;

    // Kamera yer ostiga tushib ketmasin.
    const groundY = this.ground.heightAt(desiredX, desiredZ) + 0.6;
    this.camera.position.set(desiredX, Math.max(desiredY, groundY), desiredZ);
    const direction = this.camera.position.clone().sub(this.cameraTarget);
    const length = direction.length();
    direction.normalize();
    const hit = this.physics.world.castRay(new RAPIER.Ray(this.cameraTarget, direction), length, true,
      undefined, undefined, undefined, undefined,
      (collider) => collider !== this.collider && collider !== this.carCollider);
    if (hit) this.camera.position.copy(this.cameraTarget).addScaledVector(direction, Math.max(0.25, hit.toi - 0.3));
    this.camera.lookAt(this.cameraTarget);
  }

  dispose(): void {
    this.rider?.dispose();
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeCharacterController(this.carController);
    this.physics.world.removeRigidBody(this.body);
    this.physics.world.removeRigidBody(this.carBody);
    this.mixer?.stopAllAction();
    this.avatar.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as MeshStandardMaterial).dispose();
      }
    });
    this.car.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as MeshStandardMaterial).dispose();
      }
    });
  }
}

/**
 * Oddiy mashina modeli.
 *
 * Bu vaqtinchalik: haqiqiy glTF model keyingi bosqichda qo'shiladi. Hozircha
 * muhimi — o'lchami va boshqaruvi to'g'ri bo'lsin, ko'rinishi emas.
 */
function buildCarMesh(): Group {
  const car = new Group();
  const bodyColor = new Color(0x9c2b2b);

  const chassis = new Mesh(
    new BoxGeometry(CAR_HALF.x * 2, CAR_HALF.y * 1.1, CAR_HALF.z * 2),
    new MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.35 }),
  );
  chassis.position.y = 0.1;
  chassis.castShadow = true;
  car.add(chassis);

  const cabin = new Mesh(
    new BoxGeometry(CAR_HALF.x * 1.7, CAR_HALF.y * 0.9, CAR_HALF.z * 1.05),
    new MeshStandardMaterial({ color: 0x2a3340, roughness: 0.25, metalness: 0.1 }),
  );
  cabin.position.set(0, CAR_HALF.y * 0.95, -0.15);
  cabin.castShadow = true;
  car.add(cabin);

  const wheelGeometry = new CylinderGeometry(0.36, 0.36, 0.24, 14);
  const wheelMaterial = new MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 });
  for (const [x, z] of [
    [-CAR_HALF.x, CAR_HALF.z * 0.62],
    [CAR_HALF.x, CAR_HALF.z * 0.62],
    [-CAR_HALF.x, -CAR_HALF.z * 0.62],
    [CAR_HALF.x, -CAR_HALF.z * 0.62],
  ]) {
    const wheel = new Mesh(wheelGeometry, wheelMaterial);
    wheel.rotation.z = Math.PI / 2;
    // G'ildirak pastki nuqtasi collider tagiga aniq to'g'ri kelsin.
    wheel.position.set(x!, -CAR_HALF.y + 0.36, z!);
    car.add(wheel);
  }

  return car;
}
