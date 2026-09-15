import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';

import type { Ground } from './Ground.ts';
import type { WaterZones } from './WaterZones.ts';
import { alignCharacterFeet, type LoadedModel } from './models.ts';
import type { Input } from './Input.ts';
import { RAPIER, type Physics } from './Physics.ts';
import type { Breakables } from './Breakables.ts';
import { angleDifference, approach, yawRate } from './VehicleMotion.ts';
import { animateVehicle, animateVehicleAccessories, renderVehiclePose } from './VehicleRig.ts';
import { updateModelLOD } from './ModelLOD.ts';
import { CharacterAnimator } from './CharacterAnimator.ts';
import { FootPlant } from './FootPlant.ts';
import { vehicleSpec, VEHICLE_SPECS } from './FleetAssets.ts';
import { Rider } from './Rider.ts';
import { VehicleTransitionPose } from './VehicleTransitionPose.ts';

const WALK_SPEED = 1.8;
const RUN_SPEED = 5.2;
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
  /** Mashina yo'nalishi (radian, +Z dan), yarim o'lchamlari va tezligi m/s — NPC'larga urilishni hisoblash uchun. */
  carYaw: number;
  carHalf: { x: number; y: number; z: number };
  carSpeed: number;
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
  /** Yiqitiladigan jihozlar: to'siq va urilish (`Breakables`). */
  private readonly props: Breakables | undefined;
  private rider: Rider | null = null;
  private transitionPose: VehicleTransitionPose | null = null;

  private readonly avatar: Object3D;
  private car: Object3D;
  private carFootOffset: number;
  private spec = VEHICLE_SPECS[0]!;
  /** Personaj animatsiyasi (model yuklangan bo'lsa). */
  private animator: CharacterAnimator | null = null;
  private vehicleTransition: { kind: 'enter' | 'exit'; elapsed: number; from: Vector3; to: Vector3; side: number; facing: number } | null = null;
  private entryPath: Vector3[] = [];
  private entryStalled = 0;
  private animationTime = 0;
  private wipers = false;
  private cameraOrbitHold = 0;
  private footPlant: FootPlant | null = null;
  private walkVelocity = new Vector3();
  // Keep the input basis fixed during a gesture: automatic camera rotation
  // must never feed back into A/S/D or an analog joystick's world direction.
  private walkInputYaw = 0;
  private walkInputActive = false;
  private walkCameraSpeed = 0;
  private walkCameraHeading = 0;
  private readonly velocityChange = new Vector3();

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly personalSpace = new RAPIER.Capsule(CAPSULE_HALF, CAPSULE_RADIUS + .13);

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
  private previousFacing = 0;
  /** Turish→yurish va yurish→yugurish aralashuvi, 0..1. */

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
  private readonly previousBodyPosition = new Vector3();
  private readonly previousCarPosition = new Vector3();
  private readonly visualBodyPosition = new Vector3();
  private readonly visualCarPosition = new Vector3();
  private previousCarYaw = 0;
  private previousCameraYaw = 0;
  private previousCameraPitch = 0;
  private previousSteering = 0;
  private previousPedalPhase = 0;
  private presentationReset = true;
  private cameraArmLength = 0;

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
    props?: Breakables;
  }) {
    this.physics = options.physics;
    this.ground = options.ground;
    this.input = options.input;
    this.trafficVehicleDistance = options.trafficVehicleDistance;
    this.claimTrafficVehicle = options.claimTrafficVehicle;
    this.releaseVehicle = options.releaseVehicle;
    this.props = options.props;
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
    this.controller.enableAutostep(0.5, 0.2, false);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(75);
    // Kichik nishabliklarda "sakrab" ketmaslik uchun yerga yopishtirish.
    this.controller.enableSnapToGround(0.4);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((38 * Math.PI) / 180);

    if (options.characterModel) {
      this.avatar = options.characterModel.object;
      const clips = options.characterModel.animations;
      if (clips.length) { this.animator = new CharacterAnimator(this.avatar, clips); this.footPlant=new FootPlant(this.avatar); this.transitionPose=new VehicleTransitionPose(this.avatar); }
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
      carYaw: this.carYaw,
      carHalf: this.spec.half,
      carSpeed: this.carSpeed,
      vehicleLabel: this.spec.label,
      water: this.mode === 'drive'
        ? (this.carFlood > 0.02 ? 2 : this.carDepth > 0.08 ? 1 : 0)
        : this.submersion <= 0 ? 0 : this.submersion >= SWIM_DEPTH ? 2 : 1,
    };
  }

  update(dt: number): void {
    this.previousFacing = this.facing;
    const body=this.body.translation(),car=this.carBody.translation();
    this.previousBodyPosition.set(body.x,body.y,body.z);
    this.previousCarPosition.set(car.x,car.y,car.z);
    this.previousCarYaw=this.carYaw;this.previousCameraYaw=this.yaw;this.previousCameraPitch=this.pitch;
    this.previousSteering=this.steering;this.previousPedalPhase=this.car.userData.pedalPhase??0;
    this.updateCamera(dt);
    this.animationTime += dt;
    if (this.input.wasPressed('KeyV')) this.wipers = !this.wipers;
    if (this.input.wasPressed('KeyE') && this.mode === 'walk' && !this.vehicleTransition) this.animator?.wave();

    if (this.input.wasPressed('KeyF') && !this.vehicleTransition) {
      this.entryPath = [];
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

    if (this.vehicleTransition) {
      const transition = this.vehicleTransition;
      transition.elapsed += dt;
      this.animator?.update(dt, { speed: 0, grounded: true, verticalSpeed: 0, swimming: false }, 'Idle');
      // Keep the final presentation tick, so a render between ticks never skips the handoff.
      if (transition.elapsed >= 1.25 + dt) { this.facing=this.carYaw; this.vehicleTransition = null; }
    } else if (this.mode === 'walk') this.updateWalk(dt);
    this.updateDrive(dt);
    const progress = this.vehicleTransition ? Math.min(1, this.vehicleTransition.elapsed / 1.25) : 0;
    animateVehicleAccessories(this.car, {
      time: this.animationTime, steering: this.steering,
      brake: this.mode === 'drive' && (this.input.moveAxis().y < 0 || this.input.isDown('Space')),
      door: this.vehicleTransition ? Math.min(1, progress * 5, (1 - progress) * 5) : 0,
      doorSide: this.vehicleTransition?.side ?? 1,
      wipers: this.wipers,
    });
  }

  render(alpha=1,dt=1/60): void {
    const t = this.carBody.translation();
    this.carPosition.set(t.x, t.y, t.z);
    const body=this.body.translation();
    if(this.presentationReset){
      this.previousBodyPosition.set(body.x,body.y,body.z);this.previousCarPosition.copy(this.carPosition);
      this.previousCarYaw=this.carYaw;this.previousCameraYaw=this.yaw;this.previousCameraPitch=this.pitch;
      this.previousSteering=this.steering;this.previousPedalPhase=this.car.userData.pedalPhase??0;
      this.cameraArmLength=0;this.presentationReset=false;
    }
    alpha=Math.max(0,Math.min(1,alpha));
    this.visualBodyPosition.set(body.x,body.y,body.z).lerp(this.previousBodyPosition,1-alpha);
    this.visualCarPosition.copy(this.carPosition).lerp(this.previousCarPosition,1-alpha);
    const yaw=this.previousCarYaw+angleDifference(this.carYaw,this.previousCarYaw)*alpha;
    this.animator?.render(alpha);
    this.avatar.rotation.y = this.previousFacing + angleDifference(this.facing, this.previousFacing) * alpha;
    this.syncMeshes(this.visualBodyPosition,this.visualCarPosition,yaw,dt,alpha);
    const steering=this.previousSteering+(this.steering-this.previousSteering)*alpha;
    const phase=this.previousPedalPhase+angleDifference(this.car.userData.pedalPhase??0,this.previousPedalPhase)*alpha;
    if(this.mode==='drive'&&!this.vehicleTransition){
      this.rider?.pose(this.spec,0,steering,phase);
    }
    renderVehiclePose(this.car, alpha, steering, phase);
    this.placeCamera(this.visualBodyPosition,this.visualCarPosition,
      this.previousCameraYaw+angleDifference(this.yaw,this.previousCameraYaw)*alpha,
      this.previousCameraPitch+(this.pitch-this.previousCameraPitch)*alpha,dt,alpha);
  }

  private updateCamera(dt: number): void {
    this.cameraOrbitHold=Math.max(0,this.cameraOrbitHold-dt);
    const delta = this.input.takeMouseDelta();
    if (delta.x !== 0 || delta.y !== 0) {
      this.cameraOrbitHold=1.5;
      this.yaw -= delta.x * 0.0022;
      if (this.mode === 'walk') this.walkInputYaw -= delta.x * 0.0022;
      this.pitch -= delta.y * 0.0018;
      // Kamera tik yuqoriga yoki pastga aylanib ketmasin.
      this.pitch = Math.min(Math.max(this.pitch, -1.15), 0.55);
    }

    const wheel = this.input.takeWheelDelta();
    if (wheel !== 0) {
      this.cameraDistance = Math.min(Math.max(this.cameraDistance + wheel * 0.01, 2.5), 14);
    }
    if (this.mode === 'drive' && (this.input.isDown('KeyC') || (!this.vehicleTransition && this.cameraOrbitHold===0 && Math.abs(this.carSpeed)>.7))) {
      const target = this.carYaw + (this.carSpeed<-.7?0:Math.PI);
      const difference = Math.atan2(Math.sin(target - this.yaw), Math.cos(target - this.yaw));
      this.yaw += difference * (1 - Math.exp(-4 * dt));
    }
    if (this.mode === 'walk' && !this.vehicleTransition &&
        (this.input.isDown('KeyC') || (this.cameraOrbitHold === 0 && this.walkCameraSpeed > .15))) {
      const target = (this.walkCameraSpeed > .15 ? this.walkCameraHeading : this.facing) + Math.PI;
      this.yaw += angleDifference(target, this.yaw) * (1 - Math.exp(-4 * dt));
    }
  }

  private updateWalk(dt: number): void {
    const axis = this.input.moveAxis();
    const jumpPressed=this.input.wasPressed('Space');
    if (axis.x || axis.y || jumpPressed) this.entryPath = [];
    const speed = !this.entryPath.length && (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')) ? RUN_SPEED : WALK_SPEED;

    // Harakat kamera yo'nalishiga nisbatan.
    //
    // Kamera nishondan `(sin(yaw), *, cos(yaw))` siljishda turadi, ya'ni u
    // nishonga `-(sin, cos)` yo'nalishida qaraydi. Demak "oldinga" (W) —
    // aynan shu vektor, kameradan UZOQLASHISH tomoni.
    //   oldinga = (-sin,  0, -cos)
    //   o'ngga  = ( cos,  0, -sin)   [oldinga x yuqori]
    const movingInput = Math.hypot(axis.x, axis.y) > .001;
    if (!this.walkInputActive) this.walkInputYaw = this.yaw;
    this.walkInputActive = movingInput;
    const sin = Math.sin(this.walkInputYaw);
    const cos = Math.cos(this.walkInputYaw);
    let moveX = (axis.x * cos - axis.y * sin) * speed;
    let moveZ = (-axis.x * sin - axis.y * cos) * speed;
    if (this.entryPath.length) {
      const t=this.body.translation(), next=this.entryPath[0]!, dx=next.x-t.x, dz=next.z-t.z, distance=Math.hypot(dx,dz);
      if(distance<.12){this.entryPath.shift();if(!this.entryPath.length){this.startBoarding();return;}}
      else {const pace=Math.min(speed,distance/Math.max(dt,.001));moveX=dx/distance*pace;moveZ=dz/distance*pace;}
    }
    // Reach walking pace quickly without translating faster than the first
    // visible step; release remains crisp instead of coasting across the floor.
    const change=this.velocityChange.set(moveX,0,moveZ).sub(this.walkVelocity);
    const limit=(moveX||moveZ?22:30)*dt;
    this.walkVelocity.addScaledVector(change,Math.min(1,limit/Math.max(change.length(),.0001)));
    moveX=this.walkVelocity.x;moveZ=this.walkVelocity.z;

    // Suvda sakrab bo'lmaydi: chuqurlikda tayanch yo'q.
    const jump = jumpPressed && this.submersion < 0.6;
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

    // Standing and fallen people both block the capsule; excluding all dynamics
    // previously let the player walk straight through a knocked-down pedestrian.
    this.controller.computeColliderMovement(this.collider, {
      x: moveX * dt * drag,
      y: this.verticalSpeed * dt,
      z: moveZ * dt * drag,
    }, undefined, undefined, other=>!other.isSensor());
    const movement = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const position = this.bodyPosition(this.scratch);
    position.add(new Vector3(movement.x, movement.y, movement.z));
    // Daraxt, ustun, skameyka: fizikada yo'q, shuning uchun doira bo'yicha tashqariga chiqaramiz.
    const push = this.props?.pushOut(position.x, position.z, CAPSULE_RADIUS);
    if (push) { position.x += push.x; position.z += push.z; }
    this.clampToCity(position, 1);
    // Query tolerances at terrain seams must never pull the capsule below the
    // same terrain surface used to draw the road, then pop it up next tick.
    const floor=this.ground.heightAt(position.x,position.z)+CAPSULE_HALF+CAPSULE_RADIUS+.02;
    if(position.y<floor && this.verticalSpeed<=0){position.y=floor;this.grounded=true;this.verticalSpeed=0;}
    // Leave room for the other person's movement during the upcoming physics
    // tick. This sweep also covers the correction made by decorative obstacles.
    const delta={x:position.x-start.x,y:position.y-start.y,z:position.z-start.z};
    const person=this.physics.world.castShape(start,{x:0,y:0,z:0,w:1},delta,this.personalSpace,1,false,
      undefined,undefined,this.collider,undefined,
      other=>!other.isSensor()&&other.shape.type===RAPIER.ShapeType.Capsule);
    if(person){const fraction=Math.max(0,person.toi-.001);position.x=start.x+delta.x*fraction;position.z=start.z+delta.z*fraction;}
    this.body.setNextKinematicTranslation(position);

    // Yurayotgan tomonga qarab turishi uchun avatarni buramiz. Burilish
    // BIRDANIGA emas: ilgari `rotation.y` to'g'ridan-to'g'ri qo'yilardi va
    // A/D bosilganda personaj bir kadrda 90° ga o'girilib qolardi.
    const actualSpeed = Math.hypot(position.x-start.x, position.z-start.z) / Math.max(dt, 1e-6);
    this.walkCameraSpeed = actualSpeed;
    if (actualSpeed > .15) this.walkCameraHeading = Math.atan2(movement.x, movement.z);
    if(actualSpeed<.05&&Math.hypot(moveX,moveZ)>.1)this.walkVelocity.set(0,0,0);
    if(this.entryPath.length){this.entryStalled=actualSpeed<.1?this.entryStalled+dt:0;if(this.entryStalled>1)this.entryPath=[];}
    const moving = actualSpeed > 0.08;
    if (moving) {
      this.facing += angleDifference(Math.atan2(movement.x, movement.z), this.facing) * (1 - Math.exp(-16 * dt));
      this.avatar.rotation.y = this.facing;
    }

    this.animator?.update(dt, { speed: actualSpeed, grounded: this.grounded, verticalSpeed: this.verticalSpeed, swimming });
  }

  private updateDrive(dt: number): void {
    const axis = this.mode === 'drive' && !this.vehicleTransition ? this.input.moveAxis() : { x: 0, y: 0 };
    if (this.vehicleTransition || this.entryPath.length) this.carSpeed = 0;
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

    // Piyoda paytida yerda qimirlamay turgan quruq mashina "uxlaydi": uning uchun
    // kontroller, gravitatsiya va sahna so'rovlari har qadamda qayta hisoblanardi —
    // telefonda o'yinchi yangilanishining katta qismi shu edi.
    if (this.mode === 'walk' && this.carGrounded && Math.abs(this.carSpeed) < 0.01 && level === null && this.carFlood === 0) return;

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

    // Filtr Rapier bayroqlarida: JS predikati har kollayder uchun WASM chaqiruvi edi.
    this.carController.computeColliderMovement(this.carCollider, desired,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    const movement = this.carController.computedMovement();
    this.carGrounded = this.carController.computedGrounded();

    const before = { x: this.carPosition.x, z: this.carPosition.z };
    this.carPosition.add(new Vector3(movement.x, movement.y, movement.z));
    // Jihozlar: tez urilsa yiqiladi va mashina massasiga qarab sekinlashadi, sekin tegsa to'siq.
    const impact = this.props?.carImpact(this.carPosition, this.carYaw, this.spec.half, this.carSpeed);
    if (impact?.mass) this.absorbImpact(impact.mass);
    if (impact?.push) {
      this.carPosition.x += impact.push.x;
      this.carPosition.z += impact.push.z;
      this.carSpeed = 0;
    }
    this.clampToCity(this.carPosition, 3);
    const floor=this.ground.heightAt(this.carPosition.x,this.carPosition.z)+this.spec.half.y+.02;
    if(this.carPosition.y<floor && this.carVerticalSpeed<=0){this.carPosition.y=floor;this.carGrounded=true;this.carVerticalSpeed=0;}
    if(!floating && this.carVerticalSpeed<=0){
      // A level kinematic hull can repeatedly autostep on an ordinary incline.
      // Wheel support rays provide one consistent road height, including curbs.
      const axle=this.spec.kind==='bicycle'?.585:this.spec.kind==='motorcycle'?.74:1.34;
      let support=0;
      for(const sign of [-1,1]){
        const x=this.carPosition.x+forwardX*axle*sign,z=this.carPosition.z+forwardZ*axle*sign;
        const origin={x,y:this.carPosition.y+1,z};
        const hit=this.physics.world.castRay(new RAPIER.Ray(origin,{x:0,y:-1,z:0}),this.spec.half.y+1.6,true,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS|RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC|RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
          undefined,this.carCollider);
        support+=hit?origin.y-hit.toi:this.ground.heightAt(x,z);
      }
      support=support/2+this.spec.half.y+.02;
      if(Math.abs(this.carPosition.y-support)<.25){this.carPosition.y=support;this.carVerticalSpeed=0;this.carGrounded=true;}
    }
    this.carBody.setNextKinematicTranslation(this.carPosition);

    // To'siqqa urilganda tezlikni yo'qotamiz: haqiqiy siljish so'ralganidan
    // sezilarli kichik bo'lsa, demak devorga tegdik.
    const actual = Math.hypot(this.carPosition.x - before.x, this.carPosition.z - before.z);
    animateVehicle(this.car, (this.carPosition.x - before.x) * forwardX + (this.carPosition.z - before.z) * forwardZ, this.steering);
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
    const clearance = this.spec.half.x + .55;
    const sides: Array<[number, number]> = [[clearance, .06], [-clearance, .06], [0, -this.spec.half.z - 1]];
    for (const dry of [true, false]) {
      for (const [side, behind] of sides) {
        const x = this.carPosition.x + Math.cos(this.carYaw) * side + Math.sin(this.carYaw) * behind;
        const z = this.carPosition.z - Math.sin(this.carYaw) * side + Math.cos(this.carYaw) * behind;
        if (dry && this.water.contains({ x, z }, 0.6)) continue;
        const position = { x, y: this.ground.heightAt(x, z) + CAPSULE_HALF + CAPSULE_RADIUS + 0.02, z };
        const blocked = this.physics.world.intersectionWithShape(position, { x: 0, y: 0, z: 0, w: 1 },
          new RAPIER.Capsule(CAPSULE_HALF, CAPSULE_RADIUS), undefined, undefined, this.collider);
        if (blocked) continue;
        this.mode = 'walk';
        this.walkVelocity.set(0,0,0); this.walkCameraSpeed=0; this.walkInputActive=false;
        this.previousBodyPosition.set(position.x,position.y,position.z);
        this.footPlant?.reset();
        if (this.animator) this.vehicleTransition = { kind: 'exit', elapsed: 0, from: this.vehicleSeatPosition(), to: new Vector3(position.x, position.y - CAPSULE_HALF - CAPSULE_RADIUS, position.z), side: side<0?-1:1, facing:this.carYaw };
        this.carSpeed = 0;
        this.body.setEnabled(true);
        this.body.setTranslation(position, true);
        this.body.setNextKinematicTranslation(position);
        this.physics.world.updateSceneQueries();
        this.verticalSpeed = 0;
        this.grounded = true;
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
    this.presentationReset=true;
    this.walkInputActive = false; this.walkCameraSpeed = 0;
    this.walkVelocity.set(0,0,0);this.cameraOrbitHold=0;
    this.vehicleTransition = null;
    this.entryPath = [];
    this.footPlant?.reset();
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

  /** Urilgan narsa massasiga qarab mashina tezligini yo'qotadi (kg). */
  absorbImpact(mass: number): void {
    if (mass <= 0) return;
    const massOfCar = this.spec.kind === 'car' ? 1300 : this.spec.kind === 'motorcycle' ? 220 : 90;
    this.carSpeed *= Math.max(.2, 1 - mass / (mass + massOfCar));
  }

  private enterCar(): void {
    const t=this.body.translation(),dx=t.x-this.carPosition.x,dz=t.z-this.carPosition.z,c=Math.cos(this.carYaw),s=Math.sin(this.carYaw);
    const localX=c*dx-s*dz,localZ=s*dx+c*dz,side=this.spec.half.x+.55;
    const world=(x:number,z:number)=>new Vector3(this.carPosition.x+c*x+s*z,0,this.carPosition.z-s*x+c*z);
    this.entryPath=[];this.entryStalled=0;
    if(localX<0){const end=(localZ>=0?1:-1)*(this.spec.half.z+.8);this.entryPath.push(world(-side,end),world(side,end));}
    else if(Math.abs(localZ)>this.spec.half.z+.3)this.entryPath.push(world(side,localZ));
    this.entryPath.push(world(side,.06));
  }

  private startBoarding(): void {
    this.walkInputActive = false; this.walkCameraSpeed = 0;
    this.walkVelocity.set(0,0,0);
    this.syncMeshes();
    this.rider?.pose(this.spec,0,0,this.car.userData.pedalPhase);
    const t=this.body.translation();
    if (this.animator) this.vehicleTransition = { kind: 'enter', elapsed: 0, from: new Vector3(t.x,t.y-CAPSULE_HALF-CAPSULE_RADIUS,t.z), to: this.vehicleSeatPosition(), side:1, facing:this.facing };
    this.mode = 'drive';
    this.body.setEnabled(false);
    this.rider?.pose(this.spec,0,0,this.car.userData.pedalPhase);
  }

  private vehicleSeatPosition(): Vector3 {
    if(this.rider){this.car.updateMatrixWorld(true);return this.rider.object.children[0]!.getWorldPosition(new Vector3());}
    const [x, , z] = this.spec.rig.seat;
    return new Vector3(this.carPosition.x + Math.cos(this.carYaw) * x + Math.sin(this.carYaw) * z,
      this.carPosition.y - this.carFootOffset + Math.max(.02, this.spec.rig.seat[1] - .48),
      this.carPosition.z - Math.sin(this.carYaw) * x + Math.cos(this.carYaw) * z);
  }

  private adoptVehicle(vehicle: VehicleClaim): void {
    this.presentationReset=true;
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

  private syncMeshes(t=this.body.translation(),carPosition=this.carPosition,carYaw=this.carYaw,dt=1/60,alpha=1): void {
    updateModelLOD(this.car, this.mode === 'drive' ? 0 : (t.x-this.carPosition.x)**2 + (t.z-this.carPosition.z)**2);
    // Model oyog'i `y = 0` da (`models.ts` uni shunday markazlaydi), kapsula
    // esa o'z markazida — shuning uchun model kapsulaning TAGIGA qo'yiladi.
    const footOffset = this.animator || this.avatar instanceof Group ? CAPSULE_HALF + CAPSULE_RADIUS : 0;
    this.avatar.position.set(t.x, t.y - footOffset, t.z);
    this.avatar.visible = this.mode === 'walk' || !!this.vehicleTransition;
    if(this.rider)this.rider.object.visible=this.mode==='drive' && !this.vehicleTransition;
    if (this.vehicleTransition) {
      const p = Math.max(0,Math.min(1, (this.vehicleTransition.elapsed-(1-alpha)/60) / 1.25)), phase=Math.max(0,Math.min(1,(p-.16)/.68)), smooth = phase * phase * (3 - 2 * phase);
      this.avatar.position.lerpVectors(this.vehicleTransition.from, this.vehicleTransition.to, smooth);
      this.avatar.rotation.y = this.vehicleTransition.facing+angleDifference(this.carYaw,this.vehicleTransition.facing)*Math.min(1,p*4);
      this.rider?.blendPose(this.avatar,this.vehicleTransition.kind==='enter'?smooth:1-smooth);
      if(this.rider)this.transitionPose?.apply(this.rider.object,
        this.vehicleTransition.kind==='enter'?this.vehicleTransition.from:this.vehicleTransition.to,
        this.vehicleTransition.kind==='enter'?1-smooth:smooth,this.vehicleTransition.side,this.carYaw);
    } else if (this.animator && this.avatar.visible && this.grounded && this.submersion < SWIM_DEPTH) {
      const running=this.animator.current==='Run';
      alignCharacterFeet(this.avatar, t.y-footOffset, running);
      if(dt>0){
        if(['Walk','Run'].includes(this.animator.current))this.footPlant?.update(Math.min(.1,dt),(x,z)=>this.ground.heightAt(x,z)+.02);
        else this.footPlant?.reset();
      }
    } else this.footPlant?.reset();

    this.car.position.copy(carPosition);
    this.car.position.y -= this.carFootOffset;
    this.car.rotation.y = carYaw;
    this.car.rotation.order = 'YXZ';
    if (this.carDepth > CAR_WADE_DEPTH) {
      // Suzayotgan gavda relyef qiyaligini takrorlamaydi — u suv yuzasida tekis yotadi.
      this.car.rotation.x = approach(this.car.rotation.x, 0, 1.2, dt);
      this.car.rotation.z = approach(this.car.rotation.z, 0, 1.2, dt);
    } else if (this.carGrounded) {
      const wheelHalf=this.spec.kind==='bicycle'?.585:this.spec.kind==='motorcycle'?.74:1.34;
      const dx = Math.sin(carYaw) * wheelHalf, dz = Math.cos(carYaw) * wheelHalf;
      const pitch = -Math.atan2(this.ground.heightAt(carPosition.x + dx, carPosition.z + dz)
        - this.ground.heightAt(carPosition.x - dx, carPosition.z - dz), wheelHalf*2);
      const rx = Math.cos(carYaw) * .8, rz = -Math.sin(carYaw) * .8;
      const roll = this.spec.kind==='car'?Math.atan2(this.ground.heightAt(carPosition.x + rx, carPosition.z + rz)
        - this.ground.heightAt(carPosition.x - rx, carPosition.z - rz), 1.6):
        Math.max(-.35,Math.min(.35,-Math.atan(this.carSpeed*yawRate(this.carSpeed,this.steering)/9.81)));
      const blend=1-Math.exp(-12*Math.min(.1,Math.max(0,dt)));
      this.car.rotation.x+=(pitch-this.car.rotation.x)*blend;
      this.car.rotation.z+=(roll-this.car.rotation.z)*blend;
    }
  }

  /** Kamerani nishon ortiga qo'yadi va devorga kirib ketmasligini ta'minlaydi. */
  private placeCamera(bodyPosition=this.body.translation(),carPosition=this.carPosition,yaw=this.yaw,pitch=this.pitch,dt=1/60,alpha=1): void {
    if (this.mode === 'drive') {
      this.cameraTarget.copy(carPosition);this.cameraTarget.y+=1.3;
    } else {
      const t = bodyPosition;
      this.cameraTarget.set(t.x, t.y + 0.8, t.z);
    }

    if (this.vehicleTransition) {
      const transition=this.vehicleTransition;
      const p=Math.max(0,Math.min(1,(transition.elapsed-(1-alpha)/60)/1.25));
      const blend=p*p*(3-2*p), entering=transition.kind==='enter';
      const outside=entering?transition.from:transition.to;
      this.cameraTarget.set(outside.x,outside.y+1.7,outside.z);
      this.scratch.set(carPosition.x,carPosition.y+1.3,carPosition.z);
      this.cameraTarget.lerp(this.scratch,entering?blend:1-blend);
    }

    const distance = this.mode === 'drive' ? Math.max(this.cameraDistance, 7) : this.cameraDistance;
    const horizontal = Math.cos(pitch) * distance;
    const vertical = Math.sin(-pitch) * distance;

    const offsetX = Math.sin(yaw) * horizontal;
    const offsetZ = Math.cos(yaw) * horizontal;

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
    const allowed=hit?Math.max(.25,hit.toi-.3):length;
    // Enter obstruction clearance immediately, recover gradually after a pole or
    // wall edge. Alternating ray hits must not snap the camera in and out.
    this.cameraArmLength=this.cameraArmLength===0||allowed<this.cameraArmLength?allowed:
      this.cameraArmLength+(allowed-this.cameraArmLength)*(1-Math.exp(-6*Math.min(.1,dt)));
    this.camera.position.copy(this.cameraTarget).addScaledVector(direction,this.cameraArmLength);
    this.camera.lookAt(this.cameraTarget);
  }

  dispose(): void {
    this.rider?.dispose();
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeCharacterController(this.carController);
    this.physics.world.removeRigidBody(this.body);
    this.physics.world.removeRigidBody(this.carBody);
    this.animator?.dispose();
    this.avatar.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
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
