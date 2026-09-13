import { AnimationMixer, Group, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3, type AnimationAction, type Skeleton, type Material } from 'three';
import type { Ground } from './Ground.ts';
import type { CityMapData } from './CityTile.ts';
import { alignCharacterFeet, cloneModel, type LoadedModel } from './models.ts';
import { RAPIER, type Physics } from './Physics.ts';
import type { PlayerState, VehicleClaim } from './Player.ts';
import { insidePolygon, lanePoint, projectToEdge, RoadNetwork, type PointXZ, type RoadEdge } from './RoadNetwork.ts';
import { angleDifference, approach, yawRate } from './VehicleMotion.ts';
import { WaterZones } from './WaterZones.ts';
import { animateVehicle } from './VehicleRig.ts';
import { TrafficSignals } from './TrafficSignals.ts';
import { vehicleSpec } from './FleetAssets.ts';
import { Rider } from './Rider.ts';
import { QUALITY } from './Quality.ts';

/** `blocked()` indeksining katak o'lchami, metr. */
const OBSTACLE_CELL = 50;

interface Agent {
  object: Group;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  mixer: AnimationMixer | null;
  walkAction: AnimationAction | null;
  idleAction: AnimationAction | null;
  /** Turish→yurish aralashuvi, 0..1 — svetoforda muzlab qolmasligi uchun. */
  blend: number;
  pedestrian: boolean;
  edge: RoadEdge;
  distance: number;
  speed: number;
  cruise: number;
  vertical: number;
  grounded: boolean;
  stalled: number;
  nextEdge: RoadEdge | null;
  ownedMaterials: Material[];
  steering: number;
  yaw: number;
  rider: Rider | null;
}

/** Bounded local ambient simulation. Real map lanes, shared assets, independent skeletons. */
export class Traffic {
  readonly group = new Group();
  private agents: Agent[] = [];
  private cars = new RoadNetwork([]);
  private walks = new RoadNetwork([], true);
  private obstacles: Array<{ ring: Float32Array; minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  /**
   * To'siqlarning 50 m lik katak indeksi. Har NPC har fizika qadamida `blocked()`
   * so'raydi; 9 taylda 10 mingdan ortiq kontur bor va chiziqli qidiruv telefonda
   * qadam vaqtining asosiy qismini olardi.
   */
  private obstacleGrid = new Map<string, number[]>();
  /**
   * O'yinchi mashinasi urib yuborgan NPC'lar: kinematik boshqaruvdan olinib, haqiqiy
   * dinamik jismga aylanadi (odam uchib ketadi, mashina surilib aylanadi) va bir necha
   * soniyadan keyin yo'qoladi. Ro'yxat kichik — faqat urilganlar.
   */
  private knocked: Array<{ agent: Agent; body: RAPIER.RigidBody; lift: number; age: number }> = [];
  /** Oxirgi qadamda urilgan NPC'larning jami massasi — o'yinchi mashinasi shunga sekinlashadi. */
  private impactMass = 0;
  private seed = 47021;
  private spawnTimer = 0;
  private readonly water = new WaterZones();
  readonly signals: TrafficSignals;

  constructor(private physics: Physics, private ground: Ground,
    private characters: LoadedModel[], private vehicle: LoadedModel | null, signalPoints: PointXZ[] = [], private fleet: LoadedModel[] = []) {
    this.signals = new TrafficSignals(ground, signalPoints);
    this.group.add(this.signals.group);
  }

  setMaps(maps: Iterable<CityMapData>): void {
    const list = [...maps];
    this.water.set(list.flatMap((map) => map.water));
    this.cars = new RoadNetwork(list);
    this.signals.setRoads(this.cars.edges);
    this.walks = new RoadNetwork(list, true);
    this.obstacles = list.flatMap((map) => [...map.buildings, ...map.water]).map((ring) => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
        minZ = Math.min(minZ, ring[i + 1]!); maxZ = Math.max(maxZ, ring[i + 1]!);
      }
      return { ring, minX, maxX, minZ, maxZ };
    });
    this.obstacleGrid.clear();
    this.obstacles.forEach((o, index) => {
      for (let cx = Math.floor(o.minX / OBSTACLE_CELL); cx <= Math.floor(o.maxX / OBSTACLE_CELL); cx++) {
        for (let cz = Math.floor(o.minZ / OBSTACLE_CELL); cz <= Math.floor(o.maxZ / OBSTACLE_CELL); cz++) {
          const key = `${cx},${cz}`, list = this.obstacleGrid.get(key);
          if (list) list.push(index); else this.obstacleGrid.set(key, [index]);
        }
      }
    });
  }

  private blocked(p: PointXZ): boolean {
    const cell = this.obstacleGrid.get(`${Math.floor(p.x / OBSTACLE_CELL)},${Math.floor(p.z / OBSTACLE_CELL)}`);
    if (!cell) return false;
    return cell.some((index) => {
      const o = this.obstacles[index]!;
      return p.x >= o.minX && p.x <= o.maxX && p.z >= o.minZ && p.z <= o.maxZ && insidePolygon(p, o.ring);
    });
  }

  get counts(): { cars: number; people: number } {
    return { cars: this.agents.filter((a) => !a.pedestrian).length, people: this.agents.filter((a) => a.pedestrian).length };
  }

  get snapshot() {
    return this.agents.map((a) => ({ id: a.body.handle, pedestrian: a.pedestrian, position: { ...a.body.translation() }, speed: a.speed, heading: a.yaw, road: a.edge.name, edge: a.edge.key }));
  }

  nearestVehicleDistance(point: PointXZ, radius = 7): number | null {
    let best = radius;
    let found = false;
    for (const agent of this.agents) {
      if (agent.pedestrian) continue;
      const t = agent.body.translation();
      const distance = Math.hypot(t.x - point.x, t.z - point.z);
      if (distance < best) { best = distance; found = true; }
    }
    return found ? best : null;
  }

  claimVehicle(point: PointXZ, radius = 7): VehicleClaim | null {
    let nearest: Agent | null = null, best = radius;
    for (const agent of this.agents) {
      if (agent.pedestrian) continue;
      const t=agent.body.translation(), distance=Math.hypot(t.x-point.x,t.z-point.z);
      if(distance<best){nearest=agent;best=distance;}
    }
    if(!nearest) return null;
    const t=nearest.body.translation();
    const result={position:new Vector3(t.x,t.y,t.z),yaw:nearest.yaw,speed:nearest.speed,object:nearest.object};
    this.remove(nearest,true);
    return result;
  }

  private random(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private spawn(pedestrian: boolean, player: PointXZ): void {
    const options=[...(this.vehicle?[this.vehicle]:[]),...this.fleet];
    const template = pedestrian ? this.characters[Math.floor(this.random()*this.characters.length)] : options[Math.floor(this.random()*options.length)];
    if (!template) return;
    const network = pedestrian ? this.walks : this.cars;
    const candidates = network.nearby(player, pedestrian ? 180 : 300);
    for (let attempt = 0; attempt < 30 && candidates.length; attempt++) {
      const edge = candidates[Math.floor(this.random() * candidates.length)]!;
      const nearest = projectToEdge(edge, player).distance;
      const distance = Math.max(3, Math.min(edge.length - 3, nearest + (this.random() - 0.5) * 240));
      if (edge.length < 8) continue;
      const p = lanePoint(edge, distance, pedestrian);
      const range = Math.hypot(p.x - player.x, p.z - player.z);
      if (range < 18 || range > 330 || this.blocked(p)) continue;
      if (this.agents.some((a) => { const t = a.body.translation(); return Math.hypot(t.x - p.x, t.z - p.z) < 12; })) continue;
      const model = cloneModel(template);
      const ownedMaterials: Material[] = [];
      if (!pedestrian) {
        const colors = [0xf0eee4, 0x242c36, 0x48719b, 0xaaa9a1, 0x842823];
        const paint = colors[Math.floor(this.random() * colors.length)]!;
        model.object.traverse((child) => {
          if (child instanceof Mesh && child.material instanceof MeshStandardMaterial && child.material.name === 'Paint 1 Carmine') {
            child.material = child.material.clone();
            child.material.color.setHex(paint);
            ownedMaterials.push(child.material);
          }
        });
      }
      const spec=vehicleSpec(model.object), half=spec.half;
      const halfHeight = pedestrian ? 0.9 : half.y;
      const position = { x: p.x, y: this.ground.heightAt(p.x, p.z) + halfHeight + 0.12, z: p.z };
      const shape = pedestrian ? new RAPIER.Capsule(0.55, 0.35) : new RAPIER.Cuboid(half.x, half.y, half.z);
      const yaw = Math.atan2(edge.b.x - edge.a.x, edge.b.z - edge.a.z);
      const rotation = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      if (this.physics.world.intersectionWithShape(position, rotation, shape)) {
        for (const material of ownedMaterials) material.dispose();
        continue;
      }
      const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z).setRotation(rotation));
      const collider = this.physics.world.createCollider(pedestrian ? RAPIER.ColliderDesc.capsule(0.55, 0.35) : RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
      const controller = this.physics.world.createCharacterController(0.025);
      controller.enableAutostep(pedestrian ? 0.4 : 0.25, 0.2, false);
      controller.enableSnapToGround(0.45);
      const clip = model.animations.find((c) => /Walk$/i.test(c.name)) ?? model.animations[0];
      const idleClip = model.animations.find((c) => /Idle(?:_Neutral)?$/i.test(c.name));
      const mixer = pedestrian && clip ? new AnimationMixer(model.object) : null;
      // Yurish va turish klipi bir vaqtda ishlaydi, og'irlik bilan aralashadi:
      // to'xtagan piyoda qadam o'rtasida muzlab qolmaydi, tik turadi.
      const walkAction = mixer ? mixer.clipAction(clip!).play() : null;
      const idleAction = mixer && idleClip ? mixer.clipAction(idleClip).play() : null;
      idleAction?.setEffectiveWeight(0);
      model.object.position.set(position.x, position.y - halfHeight, position.z);
      model.object.rotation.y = yaw;
      this.group.add(model.object);
      const rider=!pedestrian&&this.characters.length?new Rider(this.characters[Math.floor(this.random()*this.characters.length)]!):null;
      if(rider){model.object.add(rider.object);rider.pose(spec);}
      this.agents.push({ object: model.object, body, collider, controller, mixer, walkAction, idleAction, blend: 0, pedestrian, edge, distance,
        speed: 0, cruise: pedestrian ? 1.65 + this.random() * 0.55 : Math.min(spec.maxSpeed*.7,9 + this.random() * 6), vertical: 0, grounded: false, stalled: 0, nextEdge: null, ownedMaterials, steering: 0, yaw, rider });
      return;
    }
  }

  update(dt: number, player: PlayerState): void {
    this.signals.update(dt,player.position);
    this.hitByPlayer(player);
    for (let i = this.knocked.length - 1; i >= 0; i--) {
      const k = this.knocked[i]!;
      k.age += dt;
      if (k.age < 8) continue;
      this.physics.world.removeRigidBody(k.body);
      this.remove(k.agent, false, true);
      this.knocked.splice(i, 1);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      for (const agent of [...this.agents]) {
        const t = agent.body.translation();
        if (Math.hypot(t.x - player.position.x, t.z - player.position.z) > 550 || agent.stalled > 20) this.remove(agent);
      }
      const counts = this.counts;
      if (counts.cars < QUALITY.maxCars) this.spawn(false, player.position);
      if (counts.people < QUALITY.maxPeople) this.spawn(true, player.position);
    }

    for (const agent of this.agents) {
      if (!agent.pedestrian) { this.updateCar(agent, dt, player); continue; }
      const t = agent.body.translation();
      const dx = (agent.edge.b.x - agent.edge.a.x) / agent.edge.length;
      const dz = (agent.edge.b.z - agent.edge.a.z) / agent.edge.length;
      let targetSpeed = agent.cruise;
      const obstacles = [player.position, player.carPosition,
        ...this.agents.filter((other) => other !== agent).map((other) => other.body.translation())];
      // Brake before people/cars in our lane, including the user's parked car.
      for (const obstacle of obstacles) {
        const ox = obstacle.x - t.x, oz = obstacle.z - t.z;
        const ahead = ox * dx + oz * dz;
        const lateral = Math.abs(ox * dz - oz * dx);
        const clearance = agent.pedestrian ? 1.2 : 6;
        if (ahead > 0 && ahead < clearance + agent.speed * 1.5 && lateral < (agent.pedestrian ? 0.8 : 2.3)) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - clearance) / 1.5));
        }
      }
      agent.speed += Math.max(-8 * dt, Math.min(2.5 * dt, targetSpeed - agent.speed));
      let nextDistance = agent.distance + agent.speed * dt;
      let edge = agent.edge;
      if (nextDistance >= edge.length) {
        agent.nextEdge ??= (agent.pedestrian ? this.walks : this.cars).next(edge, this.random());
        const next = agent.nextEdge;
        if (!next) { agent.speed = 0; agent.stalled += dt; continue; }
        nextDistance -= edge.length;
        edge = next;
      }
      const target = lanePoint(edge, nextDistance, agent.pedestrian);
      const deltaX = target.x - t.x, deltaZ = target.z - t.z;
      const distance = Math.hypot(deltaX, deltaZ);
      const travel = Math.min(distance, agent.speed * dt);
      if (this.blocked(target)) {
        agent.stalled += dt;
        agent.speed = 0;
        continue;
      }
      agent.vertical = agent.grounded ? -0.8 : Math.max(-40, agent.vertical - 9.81 * dt);
      const yaw = Math.atan2(deltaX, deltaZ);
      if (travel > 0.0001) {
        agent.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
        agent.object.rotation.y = yaw;
      }
      agent.controller.computeColliderMovement(agent.collider, {
        x: distance ? deltaX / distance * travel : 0, y: agent.vertical * dt, z: distance ? deltaZ / distance * travel : 0,
      }, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
      const movement = agent.controller.computedMovement();
      agent.grounded = agent.controller.computedGrounded();
      agent.body.setNextKinematicTranslation({ x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z });
      const actual = Math.hypot(movement.x, movement.z);
      if (actual < travel * 0.4 || travel < 0.0001) agent.stalled += dt;
      else agent.stalled = 0;
      // Advance the route only when the collider really follows it (no tunnelling).
      if (distance < 0.5 + travel && actual >= travel * 0.4) {
        if (agent.edge !== edge) agent.nextEdge = null;
        agent.edge = edge;
        agent.distance = nextDistance;
      }
      if (agent.mixer) {
        const pace = actual / dt;
        agent.blend = approach(agent.blend, Math.min(1, pace / 1.1), 6, dt);
        agent.walkAction?.setEffectiveWeight(agent.idleAction ? agent.blend : 1);
        agent.idleAction?.setEffectiveWeight(1 - agent.blend);
        // Qadam uzunligi tezlikka bog'lanadi; turgan holatda turish klipi
        // o'z sur'atida davom etadi, shuning uchun mixer to'xtatilmaydi.
        agent.walkAction?.setEffectiveTimeScale(Math.max(0.05, pace / 1.4));
        agent.mixer.update(dt);
      }
    }
  }

  private updateCar(agent: Agent, dt: number, player: PlayerState): void {
    const t = agent.body.translation();
    let edge = agent.edge;
    let progress = projectToEdge(edge, t).distance;
    const originalStop = this.signals.stopDistance(edge, progress);
    const lookahead = Math.max(4, agent.speed * 0.7);
    if (edge.length - progress < lookahead + 15) agent.nextEdge ??= this.cars.next(edge, this.random());
    const next = agent.nextEdge?.to === edge.from ? null : agent.nextEdge;
    if (!Number.isFinite(originalStop) && next && edge.length - progress < lookahead &&
        (progress >= edge.length - 0.3 || projectToEdge(next, t).distance > 2)) {
      edge = next; agent.edge = next; agent.nextEdge = null;
      progress = projectToEdge(edge, t).distance;
    }
    const remaining = edge.length - progress;
    const targetDistance = progress + lookahead;
    const following = agent.nextEdge?.to !== edge.from ? agent.nextEdge : null;
    const target = targetDistance > edge.length && following
      ? lanePoint(following, Math.min(following.length, targetDistance - edge.length), false)
      : lanePoint(edge, Math.min(edge.length, targetDistance), false);
    const heading = Math.atan2(target.x - t.x, target.z - t.z);
    let desiredSpeed = agent.cruise;
    let stopDistance = this.signals.stopDistance(edge,progress);
    if (following) stopDistance = Math.min(stopDistance, remaining + this.signals.stopDistance(following,0));
    desiredSpeed = Math.min(desiredSpeed, Math.sqrt(2*5*stopDistance));
    if (following && remaining < Math.max(15, agent.speed * 2)) {
      const turn = Math.abs(angleDifference(Math.atan2(following.b.x-following.a.x, following.b.z-following.a.z),
        Math.atan2(edge.b.x-edge.a.x, edge.b.z-edge.a.z)));
      desiredSpeed = Math.min(desiredSpeed, Math.max(2.5, agent.cruise / (1 + turn * 1.8)));
    } else if (!following && remaining < 12) desiredSpeed = Math.min(desiredSpeed, Math.max(0, (remaining - 3) * 0.8));
    const forwardX = Math.sin(agent.yaw), forwardZ = Math.cos(agent.yaw);
    for (const obstacle of [player.position, player.carPosition,
      ...this.agents.filter((other) => other !== agent).map((other) => other.body.translation())]) {
      const ox = obstacle.x - t.x, oz = obstacle.z - t.z;
      const ahead = ox * forwardX + oz * forwardZ;
      if (ahead > 0 && Math.abs(ox * forwardZ - oz * forwardX) < 2.2) {
        desiredSpeed = Math.min(desiredSpeed, Math.max(0, (ahead - 6) / 1.6));
      }
    }
    const alpha = angleDifference(heading, agent.yaw);
    const targetSteering = Math.max(-0.58, Math.min(0.58, Math.atan2(2 * 2.7 * Math.sin(alpha), lookahead)));
    agent.steering = approach(agent.steering, targetSteering, 1.2, dt);
    agent.speed = approach(agent.speed, desiredSpeed, desiredSpeed < agent.speed ? 8 : 3.4, dt);
    agent.yaw += yawRate(agent.speed, agent.steering) * dt;
    const travel = Math.min(agent.speed * dt, stopDistance);
    const dx = Math.sin(agent.yaw) * travel, dz = Math.cos(agent.yaw) * travel;
    const destination = { x: t.x + dx, z: t.z + dz };
    const blocked = this.blocked(destination) || this.water.movementFraction(t, destination, 2.5) < 1;
    agent.vertical = agent.grounded ? -0.8 : Math.max(-40, agent.vertical - 9.81 * dt);
    agent.body.setRotation({ x: 0, y: Math.sin(agent.yaw/2), z: 0, w: Math.cos(agent.yaw/2) }, true);
    agent.object.rotation.y = agent.yaw;
    agent.controller.computeColliderMovement(agent.collider, { x: blocked ? 0 : dx, y: agent.vertical * dt, z: blocked ? 0 : dz }, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC);
    const movement = agent.controller.computedMovement();
    agent.grounded = agent.controller.computedGrounded();
    agent.body.setNextKinematicTranslation({ x: t.x+movement.x, y: t.y+movement.y, z: t.z+movement.z });
    const actual = Math.hypot(movement.x, movement.z);
    if (blocked || actual < 0.002) { agent.stalled += dt; if (blocked) agent.speed = 0; }
    else agent.stalled = 0;
    if (stopDistance < 1) { agent.stalled = 0; agent.speed = 0; }
    agent.distance = progress;
    animateVehicle(agent.object, movement.x * Math.sin(agent.yaw) + movement.z * Math.cos(agent.yaw), agent.steering);
    agent.rider?.pose(vehicleSpec(agent.object),actual,agent.steering);
  }

  render(): void {
    for (const { agent, body, lift } of this.knocked) {
      const t = body.translation(), r = body.rotation();
      agent.object.quaternion.set(r.x, r.y, r.z, r.w);
      // Jism markazi gavda o'rtasida; model esa oyoq/g'ildirak sathidan boshlanadi.
      const offset = new Vector3(0, -lift, 0).applyQuaternion(agent.object.quaternion);
      agent.object.position.set(t.x + offset.x, t.y + offset.y, t.z + offset.z);
    }
    for (const agent of this.agents) {
      const t = agent.body.translation();
      agent.object.position.set(t.x, t.y - (agent.pedestrian ? 0.9 : vehicleSpec(agent.object).half.y), t.z);
      if (agent.pedestrian) alignCharacterFeet(agent.object, t.y - 0.9);
      // Match the visible wheels to a mild road slope; physical hull stays stable.
      if (!agent.pedestrian) {
        agent.object.rotation.order = 'YXZ';
        const yaw = agent.object.rotation.y;
        const dx = Math.sin(yaw) * 1.6, dz = Math.cos(yaw) * 1.6;
        agent.object.rotation.x = -Math.atan2(this.ground.heightAt(t.x + dx, t.z + dz) - this.ground.heightAt(t.x - dx, t.z - dz), 3.2);
        const rx=Math.cos(yaw)*.8, rz=-Math.sin(yaw)*.8;
        agent.object.rotation.z = Math.atan2(this.ground.heightAt(t.x+rx,t.z+rz)-this.ground.heightAt(t.x-rx,t.z-rz),1.6);
      }
    }
  }

  /** Mashina to'rtburchagiga tushgan NPC'larni urib yuboradi. */
  private hitByPlayer(player: PlayerState): void {
    if (player.mode !== 'drive' || Math.abs(player.carSpeed) < 3) return;
    const fx = Math.sin(player.carYaw), fz = Math.cos(player.carYaw), rx = fz, rz = -fx;
    const c = player.carPosition, h = player.carHalf;
    for (const agent of [...this.agents]) {
      const t = agent.body.translation(), dx = t.x - c.x, dz = t.z - c.z;
      const reach = agent.pedestrian ? .45 : vehicleSpec(agent.object).half.x;
      // Kinematik kollayderlar mashinani biroz oldinroq to'xtatadi — shuning uchun 0.6 m zaxira.
      if (Math.abs(dx * fx + dz * fz) > h.z + reach + .6 || Math.abs(dx * rx + dz * rz) > h.x + reach + .6) continue;
      this.knockDown(agent, fx * player.carSpeed, fz * player.carSpeed);
    }
  }

  private knockDown(agent: Agent, vx: number, vz: number): void {
    const t = agent.body.translation(), r = agent.body.rotation();
    this.physics.world.removeCharacterController(agent.controller);
    this.physics.world.removeRigidBody(agent.body);
    this.agents = this.agents.filter((other) => other !== agent);
    agent.mixer?.stopAllAction();
    const spec = vehicleSpec(agent.object), mass = agent.pedestrian ? 75 : 1100;
    const lift = agent.pedestrian ? .9 : spec.half.y;
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(t.x, t.y + .05, t.z).setRotation(r).setLinearDamping(.3).setAngularDamping(agent.pedestrian ? .6 : 1.2).setCcdEnabled(true));
    this.physics.world.createCollider((agent.pedestrian ? RAPIER.ColliderDesc.capsule(.55, .3) : RAPIER.ColliderDesc.cuboid(spec.half.x, spec.half.y, spec.half.z))
      .setMass(mass).setFriction(agent.pedestrian ? .8 : .5).setRestitution(.15), body);
    const speed = Math.hypot(vx, vz), share = agent.pedestrian ? 1.15 : .55;
    body.applyImpulse({ x: vx * mass * share, y: mass * (agent.pedestrian ? Math.min(6, 1.5 + speed * .35) : Math.min(3, speed * .12)), z: vz * mass * share }, true);
    // Odam oldinga ag'dariladi, mashina esa o'z o'qi atrofida aylanib ketadi.
    const ux = vx / (speed || 1), uz = vz / (speed || 1), spin = (Math.random() - .5) * 2;
    body.applyTorqueImpulse(agent.pedestrian
      ? { x: uz * mass * speed * .35, y: spin * mass * .6, z: -ux * mass * speed * .35 }
      : { x: 0, y: spin * mass * speed * .45, z: 0 }, true);
    this.impactMass += agent.pedestrian ? mass * .5 : mass;
    this.knocked.push({ agent, body, lift, age: 0 });
  }

  /** O'yinchi mashinasiga qaytadigan zarba massasi (o'qilgach nolga tushadi). */
  takeImpact(): number {
    const mass = this.impactMass;
    this.impactMass = 0;
    return mass;
  }

  private remove(agent: Agent, transfer = false, detached = false): void {
    agent.rider?.dispose();
    agent.mixer?.stopAllAction();
    agent.mixer?.uncacheRoot(agent.object);
    const skeletons = new Set<Skeleton>();
    agent.object.traverse((child) => { if (child instanceof SkinnedMesh) skeletons.add(child.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    this.group.remove(agent.object);
    if (!detached) {
      this.physics.world.removeCharacterController(agent.controller);
      this.physics.world.removeRigidBody(agent.body);
    }
    if(!transfer)for (const material of agent.ownedMaterials) material.dispose();
    this.agents = this.agents.filter((other) => other !== agent);
    // Geometry/materials belong to the shared model, not the clones.
  }

  reset(): void {
    for (const agent of [...this.agents]) this.remove(agent);
    for (const k of this.knocked) { this.physics.world.removeRigidBody(k.body); this.remove(k.agent, false, true); }
    this.knocked = [];
    this.spawnTimer = 0;
  }
  dispose(): void { this.reset(); this.signals.dispose(); }
}
