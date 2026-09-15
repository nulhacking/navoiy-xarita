# Model and animation sources

Human base mesh, game_engine rig, skin, eyes, hair, brows, clothing, shoes and
plain recolored cap derive from MakeHuman Community / MPFB core and system
assets and the hats01 CC0 pack. Graphical assets are CC0; MPFB tooling is GPL
and is not bundled into the runtime GLBs.

- https://static.makehumancommunity.org/mpfb/assets/assetpacks.html
- https://github.com/makehumancommunity/mpfb2
- https://creativecommons.org/publicdomain/zero/1.0/

Walk and Run derive from CMU 08_01 and 09_01, BVH conversion by Bruce Hahne.
The dataset and conversion allow research and commercial use worldwide with
no additional restrictions. Captures were cropped, retargeted, looped and
converted into in-place animation with measured stride speeds.

The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

- https://mocap.cs.cmu.edu/
- https://github.com/una-dinosauria/cmu-mocap/blob/master/READMEFIRST.txt

Other animation clips, sedan and SUV surface models, hinges, interiors, rigs,
LOD integration and material adjustments were authored for Xarita in Blender
and Three.js. Design PNGs are generated concept references and are not actual
renders of the game models. Existing third-party city assets retain their
separate attribution in `/models/credits.html`.

Small headlamp and grille regions of the generated design PNGs also supply
optical surface detail through UV mapping on the vehicle geometry.
