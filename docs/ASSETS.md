# Asset provenance

Every binary or data asset in this repository is listed here. Nothing is derived from a real property, photo, video, scan or floorplan.

| Path | Origin | How it is made | License |
| --- | --- | --- | --- |
| `assets/room.glb` | Generated | `scripts/generate-demo.py`: axis-aligned boxes from invented round-number dimensions (5.6 × 4.0 m floor, 2.5 m walls, fixed window, fixed cabinet) | Output of the MIT-licensed generator; no third-party input |
| `assets/room.json` | Generated | Same script: semantic groups (`Floor`, `Walls`, `Fixed cabinet`), no doors, one level | Output of the MIT-licensed generator; no third-party input |
| `assets/clay-normal.png` | Generated | Same script: tileable normal map from a fixed sum of sinusoids | Output of the MIT-licensed generator; no third-party input |
| `assets/preview.png` | Generated | Same script: flat top-down plan diagram of the invented room and default layout; not a render or photo | Output of the MIT-licensed generator; no third-party input |
| `assets/og.png` | Generated | Same script: the same plan diagram at 1200 × 630 for link previews | Output of the MIT-licensed generator; no third-party input |
| `docs/preview.png` | Generated screenshot | Local browser capture of the invented practice room and original procedural furniture; no real-property imagery | Output of the original project code; PlayCanvas engine notice retained separately |
| Furniture (`furniture.mjs`, `rounded.mjs`) | Original source code | Procedural boxes, cylinders and spheres built at runtime; no model files | MIT, see `LICENSE` |
| `skills/blender-room-tour/` (except the PlayCanvas files) | Original source code | Portable skill code, including `viewer.js` (MIT notice in its header) and the invented `examples/synthetic_room.py` | MIT, see `skills/blender-room-tour/LICENSE` |
| `assets/playcanvas.min.js` | Third party: PlayCanvas Engine v2.21.4 | Unmodified minified build | MIT (PlayCanvas Ltd.), see `assets/PLAYCANVAS-LICENSE.txt` |
| `skills/blender-room-tour/scripts/blender_tour_flow/assets/playcanvas.min.js` | Third party: PlayCanvas Engine v2.21.4 | Viewer copy bundled with the portable skill | MIT (PlayCanvas Ltd.), see the `PLAYCANVAS-LICENSE.txt` next to it |

The generated assets are produced entirely by `scripts/generate-demo.py`, which is original code under the root MIT `LICENSE`. They take no third-party input. Regenerate them with `npm run generate:demo`. `npm run test:py` fails if the checked-in files differ from the generator output.

## PlayCanvas notice

PlayCanvas Engine is Copyright (c) 2011-2026 PlayCanvas Ltd. and is distributed under the MIT License. The full notice ships with each copy (`assets/PLAYCANVAS-LICENSE.txt`, and the skill's copy). Both build steps (`build_public.py`, `scripts/build-release.mjs`) publish it alongside the engine, together with the project's own `LICENSE`.

## Not included

The live site's 18 prepared homes are not included. That covers their models, metadata, thumbnails, source videos and Blender files. Production hosting configuration, private share records and internal notes are also excluded. This repository's license does not apply to any of that excluded material.
