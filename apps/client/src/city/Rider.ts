import { Bone, Group, Matrix4, Quaternion, SkinnedMesh, Vector3, type Object3D } from 'three';
import { cloneModel, type LoadedModel } from './models.ts';
import type { VehicleSpec } from './FleetAssets.ts';
import { BICYCLE_METRES_PER_RADIAN } from './VehicleMotion.ts';

/**
 * Chap va o'ng tomon belgisi.
 *
 * Transport +Z ga qaraydi, Y tepaga — demak mahalliy +X CHAPGA qaraydi
 * (o'ng qo'l qoidasi: X × Y = Z). Shuning uchun chap oyoq/qo'l +1.
 */
const SIDES = [['L', 1], ['R', -1]] as const;

/** Rul ustunining tikkalikdan og'ishi, radian — qo'llar shu tekislikda yuradi. */
const COLUMN_TILT = 0;

/**
 * Transportda o'tirgan personaj: mustaqil skeletli klon.
 *
 * Poza animatsiya klipidan emas, protsedural quriladi — chunki CC0
 * personajlarda "haydash" klipi yo'q, va bitta klip baribir har xil
 * o'lchamdagi mashina, mototsikl va velosipedga to'g'ri kelmaydi. Buning
 * o'rniga har bir transport o'z TAYANCH NUQTALARINI beradi (`VehicleSpec.rig`:
 * egar, rul/dastak, pedal) va oyoq-qo'l ikki bo'g'imli teskari kinematika
 * bilan o'sha nuqtalarga yetkaziladi. Shunda bitta personaj barcha
 * transportga bir xil ishonarli o'tiradi.
 */
export class Rider {
  readonly object = new Group();
  private readonly model: Group;
  private readonly bones = new Map<string, Bone>();
  private readonly skins: SkinnedMesh[] = [];
  /** Har bir suyakning boshlang'ich (o'lchamga moslangan) holati — pozadan oldin shu tiklanadi. */
  private readonly rest = new Map<Bone, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
  /** Pedal aylanish fazasi, radian. */
  private phase = 0;
  private lastSpec = '';
  private lastSteering = Infinity;
  private lastPhase = Infinity;
  private readonly handFrames = new Map<string,{rotation:Quaternion;curlAxis:Vector3}>();

  constructor(template: LoadedModel) {
    this.model = cloneModel(template).object;
    this.object.add(this.model);
    this.model.traverse((node) => {
      // GLTFLoader tugun nomlaridagi `.` ni `_` ga almashtiradi; ikkala
      // ko'rinish ham bitta kalitga tushsin.
      if (node instanceof Bone) {
        this.bones.set(node.name.replace(/[._]/g, ''), node);
        this.rest.set(node, { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
      }
      if (node instanceof SkinnedMesh) this.skins.push(node);
    });
    this.object.name = 'VisibleRider';
    this.object.updateMatrixWorld(true);
    for(const [side,sign] of SIDES){
      const hand=this.bone(`Hand${side}`),middle=this.bone(`middle01${side.toLowerCase()}`),index=this.bone(`index01${side.toLowerCase()}`),pinky=this.bone(`pinky01${side.toLowerCase()}`);
      if(!hand||!middle||!index||!pinky)continue;
      const forward=middle.getWorldPosition(new Vector3()).sub(hand.getWorldPosition(new Vector3())).normalize();
      const across=index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3()));across.addScaledVector(forward,-across.dot(forward)).normalize();
      const normal=new Vector3().crossVectors(across,forward).normalize();
      const restFrame=new Matrix4().makeBasis(across,normal,forward);
      const wantedForward=new Vector3(0,-.12,1).normalize(),wantedAcross=new Vector3(-sign,0,0);
      const wantedFrame=new Matrix4().makeBasis(wantedAcross,new Vector3().crossVectors(wantedAcross,wantedForward),wantedForward);
      this.handFrames.set(side,{rotation:new Quaternion().setFromRotationMatrix(wantedFrame.multiply(restFrame.invert())),curlAxis:across});
    }
  }

  /**
   * Personajni transportga o'tqazadi.
   *
   * @param distance bosib o'tilgan masofa, metr — pedal aylanishi uchun
   * @param steering rul burchagi, radian
   */
  pose(spec: VehicleSpec, distance = 0, steering = 0, pedalPhase?:number): void {
    const rig = spec.rig;
    // Wheel radius × gear ratio sets cadence, not crank-arm length. The old
    // formula spun the feet backwards at roughly 300 rpm at ordinary speed.
    if (rig.crank > 0) this.phase = pedalPhase ?? (this.phase - distance / BICYCLE_METRES_PER_RADIAN) % (Math.PI * 2);
    if (spec.id === this.lastSpec && Math.abs(steering-this.lastSteering)<1e-5 && Math.abs(this.phase-this.lastPhase)<1e-5) return;
    this.lastSpec=spec.id;this.lastSteering=steering;this.lastPhase=this.phase;

    // `skeleton.pose()` EMAS: u suyaklarni bog'lanish matritsalaridan quradi, ular esa
    // modelni o'lchamga moslashdan oldingi masshtabda. BaseHuman piyodalarida bu
    // skeletni ~20 barobar kattalashtirib, NPC haydovchini binodan baland qilardi.
    for (const [bone, rest] of this.rest) {
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.quaternion);
      bone.scale.copy(rest.scale);
    }
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.object.updateMatrixWorld(true);

    const hips = this.bone('Hips');
    if (!hips) return;

    // 1. Chanoqni egarga qo'yamiz.
    const pelvis = this.object.worldToLocal(hips.getWorldPosition(new Vector3()));
    this.model.position.set(rig.seat[0] - pelvis.x, rig.seat[1] - pelvis.y, rig.seat[2] - pelvis.z);
    this.object.updateMatrixWorld(true);

    // 2. Gavdani egamiz. Og'irlik PASTKI bo'g'imga beriladi: egilish teng
    //    taqsimlanganda yelka deyarli qimirlamasdi — burchakning katta qismi
    //    ko'krakda, ya'ni umurtqaning eng uchida sarflanardi. Aslida
    //    velosipedchi ham, mototsiklchi ham asosan BELDAN egiladi.
    //    `Chest` hamma riggda yo'q; yo'g'ida uning ulushi qolganlarga bo'linadi.
    const spine: Array<[string, number]> = [['Abdomen', .55], ['Torso', .28], ['Chest', .17]];
    const present = spine.filter(([name]) => this.bone(name));
    const total = present.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (const [name, weight] of present) this.pitch(this.bone(name)!, rig.lean * weight / total);
    // Bosh yo'lga qaraydi, tizzaga emas: bo'yin egilishning teskarisiga buriladi.
    const neck = this.bone('Neck');
    if (neck) this.pitch(neck, -rig.lean * 0.45);
    const head = this.bone('Head');
    if (head) this.pitch(head, -rig.lean * 0.35);
    this.object.updateMatrixWorld(true);

    for (const [side, sign] of SIDES) {
      // 3. Oyoq: pedalga yoki oyoq tayanchiga.
      const angle = this.phase + (sign > 0 ? 0 : Math.PI);
      const ankle = new Vector3(
        (spec.kind === 'car' ? rig.seat[0] : 0) + sign * rig.foot[0],
        rig.foot[1] + (rig.crank > 0 ? Math.sin(angle) * rig.crank : 0),
        rig.foot[2] + (rig.crank > 0 ? Math.cos(angle) * rig.crank : 0),
      );
      // Tizza oldinga va tashqariga chiqadi — hech qachon orqaga bukilmaydi.
      const knee = new Vector3((spec.kind === 'car' ? rig.seat[0] : 0) + sign * (rig.foot[0] + 0.22), (rig.seat[1] + rig.foot[1]) / 2 + 0.2, rig.foot[2] + 0.6);
      this.limb(`UpperLeg${side}`, `LowerLeg${side}`, ankle, knee);
      // Tovon — ildiz fazosidagi mustaqil suyak (Quaternius IK riggi), uni
      // to'piqqa qo'lda ko'chiramiz. Burilishi bog'lanish pozasidagidek
      // gorizontal qoladi: pedalda ham, gaz pedalida ham oyoq shunday turadi.
      const foot = this.bone(`Foot${side}`);
      if (foot?.parent) {
        foot.position.copy(foot.parent.worldToLocal(this.object.localToWorld(ankle.clone())));
        if (/LowerLeg/.test(foot.parent.name)) foot.quaternion.copy(foot.parent.getWorldQuaternion(new Quaternion()).invert().multiply(this.object.getWorldQuaternion(new Quaternion())));
        foot.updateWorldMatrix(false, true);
      }

      // 4. Qo'l: rul yoki dastakka.
      const hand = this.grip(spec, sign, steering);
      if(spec.kind!=='car')hand.add(new Vector3(0,.035,-.045));
      // Tirsak pastga va orqaga qaraydi.
      const elbow = hand.clone().add(new Vector3(sign * .16, -.28, -.25));
      this.limb(`UpperArm${side}`, `LowerArm${side}`, hand, elbow);
      this.grasp(side,sign,spec.kind!=='car',steering);
    }
    this.object.updateMatrixWorld(true);
  }

  /** Qo'l tayanch nuqtasi: rul burilishi bilan birga siljiydi. */
  private grip(spec: VehicleSpec, sign: number, steering: number): Vector3 {
    const [half, y, z] = spec.rig.grip;
    if (spec.kind === 'car') {
      // Rul g'ildirakdan ko'proq buriladi; qo'llar rul tekisligida yuradi.
      const turn = steering * 2.6;
      const around = sign * (Math.PI / 2) - turn * sign * sign;
      return new Vector3(
        spec.rig.seat[0] + Math.sin(around) * half,
        y + Math.cos(around) * half * Math.cos(COLUMN_TILT),
        z - Math.cos(around) * half * Math.sin(COLUMN_TILT),
      );
    }
    // Dastak burilish o'qi atrofida aylanadi: qo'llar unga ergashadi.
    const cos = Math.cos(steering);
    const sin = Math.sin(steering);
    if(spec.kind==='bicycle')return new Vector3(sign*half*cos+(z-.585)*sin,y,.585-sign*half*sin+(z-.585)*cos);
    return new Vector3(sign * half * cos, y, z + sign * half * sin);
  }

  /**
   * Ikki bo'g'imli teskari kinematika.
   *
   * Uchinchi suyak (to'piq/bilak) HAR DOIM `lower` ning birinchi bolasi —
   * uni `instanceof Bone` bilan izlash xato edi: Quaternius riggida tizza
   * ostidagi tugun (`LowerLeg.L_end`) skin bo'g'imi emas va GLTFLoader uni
   * oddiy `Object3D` qilib yuklaydi, natijada oyoq umuman bukilmasdi.
   */
  private limb(upperName: string, lowerName: string, targetLocal: Vector3, poleLocal: Vector3): void {
    const upper = this.bone(upperName);
    const lower = this.bone(lowerName);
    const end = lower?.children[0];
    if (!upper || !lower || !end) return;
    const start = upper.getWorldPosition(new Vector3());
    const middle = lower.getWorldPosition(new Vector3());
    const tip = end.getWorldPosition(new Vector3());
    const l1 = start.distanceTo(middle);
    const l2 = middle.distanceTo(tip);
    if (l1 < 0.001 || l2 < 0.001) return;
    const target = this.object.localToWorld(targetLocal.clone());
    const pole = this.object.localToWorld(poleLocal.clone());
    const direction = target.clone().sub(start);
    const d = Math.min(l1 + l2 - 0.001, Math.max(0.001, direction.length()));
    direction.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const bend = pole.sub(start);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(0, 1, 0).addScaledVector(direction, -direction.y);
    bend.normalize();
    const joint = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    this.aim(upper, lower, joint);
    this.aim(lower, end, target);
  }

  /** `bone` ni shunday buradiki, `child` nishonga qarab tursin. */
  private aim(bone: Bone, child: Object3D, target: Vector3): void {
    const start = bone.getWorldPosition(new Vector3());
    const from = child.getWorldPosition(new Vector3()).sub(start).normalize();
    const to = target.clone().sub(start).normalize();
    const world = bone.getWorldQuaternion(new Quaternion()).premultiply(new Quaternion().setFromUnitVectors(from, to));
    const parent = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    bone.quaternion.copy(parent.invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }

  /**
   * Suyakni transportning KO'NDALANG o'qi atrofida buradi.
   *
   * `bone.rotation.x` ga qo'shish noto'g'ri: Blender'dan kelgan suyaklarning
   * mahalliy o'qlari suyak bo'ylab yo'naltirilgan, shuning uchun "oldinga
   * egilish" har bir bo'g'imda boshqa yo'nalishga aylanardi. Bu yerda burilish
   * DUNYO fazosida qo'llanadi.
   */
  private pitch(bone: Bone, angle: number): void {
    if (!angle) return;
    const axis = new Vector3(1, 0, 0).applyQuaternion(this.object.getWorldQuaternion(new Quaternion()));
    const world = bone.getWorldQuaternion(new Quaternion())
      .premultiply(new Quaternion().setFromAxisAngle(axis, angle));
    const parent = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
    bone.quaternion.copy(parent.invert().multiply(world));
    bone.updateWorldMatrix(false, true);
  }

  private bone(...names: string[]): Bone | undefined {
    for (const name of names) {
      const bone = this.bones.get(name);
      if (bone) return bone;
    }
    return undefined;
  }

  private grasp(side:string,sign:number,handlebar:boolean,steering:number):void {
    const frame=this.handFrames.get(side),hand=this.bone(`Hand${side}`);if(!frame||!hand?.parent)return;
    if(handlebar)hand.quaternion.copy(hand.parent.getWorldQuaternion(new Quaternion()).invert()
      .multiply(this.object.getWorldQuaternion(new Quaternion()))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),steering)).multiply(frame.rotation));
    for(const finger of ['index','middle','ring','pinky'])for(let joint=1;joint<=3;joint++){
      const bone=this.bone(`${finger}0${joint}${side.toLowerCase()}`);if(!bone)continue;
      const curl=finger==='index'?.82:finger==='middle'?1:finger==='ring'?1.06:1.12;
      bone.quaternion.multiply(new Quaternion().setFromAxisAngle(frame.curlAxis,-sign*curl*(joint===1?.5:joint===2?.85:.55)));
    }
    hand.updateWorldMatrix(false,true);
  }

  /** Use the same seated skeleton at both sides of the visible rider handoff. */
  blendPose(target: Object3D, seated: number): void {
    target.traverse(node=>{if(!(node instanceof Bone))return;const source=this.bones.get(node.name.replace(/[._]/g,''));if(!source)return;node.quaternion.slerp(source.quaternion,seated);node.position.lerp(source.position,seated);});
    target.updateMatrixWorld(true);
  }

  dispose(): void {
    for (const skin of this.skins) skin.skeleton.dispose();
    this.object.removeFromParent();
  }
}
