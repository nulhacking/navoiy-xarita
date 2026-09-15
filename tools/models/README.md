# Reference models

The game and `/models.html` load the six optimized GLBs in
`apps/client/public/models/reference`. The PNG turnarounds are design references,
not screenshots of these models. The models remain approximations of those images.

## Build

Run `npm run dev`, then `node tools/models/build-reference.mjs`. Set `BLENDER_EXE`
if Blender is not at `D:/Programs/Blender 5.2/blender.exe`. The current build was
made with Blender 5.2.1 LTS. The authoring browser is Chrome or Edge.

Local build prerequisites in `artifacts/blender-work`:

- `vendor/mpfb2-master/src`: MPFB source from https://github.com/makehumancommunity/mpfb2
- `assets`: extracted MakeHuman system assets CC0 and hats01 CC0 packs from
  https://static.makehumancommunity.org/mpfb/assets/assetpacks.html
- `mocap/walk.bvh` and `mocap/run.bvh`: CMU clips 08_01 and 09_01, from
  https://github.com/una-dinosauria/cmu-mocap/tree/master/data
- `build-tools/node_modules`: `@gltf-transform/core@4`, `@gltf-transform/functions@4`,
  `@gltf-transform/extensions@4`, `meshoptimizer`, and `sharp`.

`blender_humans.py` fits the anatomy, clothes and neutral armature. It retains
editable `*-source.blend` masters, textures, raw high geometry and a decimated LOD.
`pack-blender.mjs` rebinds both levels to common bones and retargets captured Walk/Run.
The other gestures are authored clips. `blender_vehicles.py` builds body panels,
interiors and named door/wheel assemblies; the car packer keeps those pivots.
Headlamp and grille UVs use small regions of the generated turnarounds for
optical detail; these are mapped onto shaped geometry.
`optimize-reference.mjs` applies WebP textures and meshopt geometry compression.

The earlier `reference-characters.mjs`/`reference-vehicles.mjs` surface generators
are retained as authoring history; `build-reference.mjs` no longer invokes them.
`makeAnimations` in the character module supplies the non-locomotion clips.

## Review

In `/models.html`, select each model and animation. The timeline stops on any
frame; front/side/back, wireframe and distant-detail controls assist inspection.
`node tools/models/audit-poses.mjs` renders every clip, with four frames for gait
and entry/exit, under `artifacts/avatar-turnarounds/3d/audit`.

Run `node tools/smoke/reference-models.mjs`, `npm run test:city`, `npm run test:fleet`,
`npm run typecheck` and `npm run build`. Runtime boarding follows a collision-tested
walk to the driver door and blends to the exact Rider IK pose; the standalone
EnterVehicle/ExitVehicle clips show a generic pose without a car.

LOD changes at 24 m for people / 45 m for cars, with hysteresis and lower mobile
thresholds. NPC skeletons update at 60 Hz within 45 m and 30 Hz farther away. Geometry is shared;
independent skeletons and accessory transforms are retained. FPS measurements
depend on the device, scene and WebGL renderer and are not a 60 FPS guarantee.

Runtime support-foot IK reduces drift while leaving the swing foot and run
flight phase free. It runs for the player and pedestrians within 25 m. Camera
follow aligns behind signed vehicle travel, pauses for 1.5 seconds after mouse
orbit input, and resumes smoothly. Movement uses a short acceleration ramp and
brisk stopping. `node tools/smoke/movement-feel.mjs` measures stance drift and
checks forward/turn/reverse camera tracking and manual orbit. The latest
straight-line test measured about 75% less walking stance drift and 44% less
running stance drift; these figures are not guarantees for every terrain/turn.

Pedestrian camera follow uses collision-resolved travel. A held keyboard/joystick
gesture keeps its world-space input basis while the camera turns; releasing the
gesture starts the next one from the current view. Manual camera rotation remains
available. `node tools/smoke/pedestrian-camera.mjs` checks cardinal, diagonal and
analog travel at 30/60/120 Hz, stationary view, manual orbit and resumption.

The current road bicycle is authored in `apps/client/src/city/Bicycle.ts`; the
older downloaded GLB remains archived with its attribution. Wheel, fork, crank
and pedal assemblies are batched separately. A shared phase drives the cranks and
Rider's feet, with approximately 5.4 m of travel per revolution. Finger curl and
handlebar wrist orientation are procedural. `node tools/smoke/bicycle-motion.mjs`
checks wheel contact, pedal direction, cadence, uninterrupted updates and sole/pedal
alignment through forward/reverse movement.

`warmScene.ts` uploads both LODs, textures and shadow/display shader variants before
gameplay. It restores visibility, culling, viewport and template ownership after
warming. Facade updates use cached spatial indexes and one tile per frame; distant
tiles skip detail construction. Adaptive quality reduces shadow update frequency
instead of recompiling every material by disabling shadows. Run
`node tools/smoke/frame-pacing.mjs label` alone to profile camera turns and repeated
detail refreshes at 1280×900 with GPU completion included. This is a short controlled
test, not a guarantee against stalls during every route or on every device.

Known fidelity limits: facial expressions and finger grasp have no captured
animation; garments and car surfaces still differ from the turnaround reference.
This is not a photogrammetry or production photoreal asset set.

Player presentation interpolates fixed-step body positions, heading, camera,
wheel roll, crank phase and animated bones. Animation snapshots retain a separate
raw mixer pose: restoring an additive idle pose would accumulate rotations when
Three.js skips writing unchanged tracks. Foot IK runs after interpolation.
Two wheel support rays stabilize the vehicle hull on inclines; camera clearance
recovers gradually after an obstruction. `node tools/smoke/ride-stability.mjs`
checks flat and sloped triangle terrain at 60/90/120/144 Hz, including wheel frames,
vertical steps and rider/seat alignment.

Walking uses explicit collider predicates for both standing and fallen people,
plus a capsule sweep for personal space. This avoids relying on query flag values
that excluded different body types in the installed Rapier WASM. Dynamic bodies
cannot be autostepped. `node tools/smoke/human-motion.mjs` checks walking and arm
continuity at four refresh rates, ten seconds of bounded idle motion, person
contact and retreat, and sedan/SUV/bicycle exit continuity. Idle breathing, gaze
and arms use independent rhythms. `VehicleTransitionPose` stages the feet through
the door one at a time, while min/max transition poses preserve the rider handoff.
`node tools/smoke/boarding-audit.mjs` saves actual entry and exit frames for review.
