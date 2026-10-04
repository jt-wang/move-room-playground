# Development guide


`.nvmrc` pins Node 22; verification used Node 24.13.1. The only dev dependencies are the exact pinned versions esbuild 0.25.0 and Playwright 1.55.1. Nothing is installed globally.

```sh
npm ci
npm run build          # build:public, then build:release (bundled into release-public/)
npm test               # Node unit tests, including server boundary tests
npm run test:py        # stdlib Python: generator, GLB/PNG validity, build allowlist, skill tests
npm run test:browser   # optional: Playwright smoke test using your installed Chrome
npm run serve:release  # serve release-public/ locally
```

`npm run test:browser` needs `npm run build:public` first and Google Chrome installed. Screenshots go to `output/browser/`. Set `PLAYWRIGHT_CHANNEL=chromium` to use a Playwright-managed Chromium instead, if you have one.

### Static hosting limitation

`release-public/` is plain static files and can be hosted anywhere. Short share links need the `/api/share` endpoint, which only `serve.mjs` provides here. On a static host, the share button reports that it could not create a link. Placement, local autosave and image export still work. This repository includes no production backend or deployment configuration.

### Telemetry

Off by default, and nothing is ever sent to a third party. Local metrics are opt-in on both sides: set `localStorage['move-demo:telemetry-opt-in']='1'` in the browser, and start the server with `ROOM_METRICS_FILE=/some/path.jsonl node serve.mjs`. The fixed event schema is in `metrics.mjs`.

## Reproduce the demo room

```sh
npm run generate:demo   # = python3 scripts/generate-demo.py → assets/room.glb, room.json, clay-normal.png, preview.png, og.png
```

The output is byte-for-byte deterministic, and `npm run test:py` checks that the checked-in assets match it. `preview.png` and `og.png` are flat plan diagrams drawn by the script, not renders or photos.

## Source map

| Path | Role |
| --- | --- |
| `index.html`, `style.css` | Page shell and styles |
| `app.mjs` | Scene setup, input, camera, editing, share and save flows |
| `layout.mjs` | Furniture catalog, default layout, layout encode/validate |
| `furniture.mjs`, `rounded.mjs`, `clay.mjs` | Procedural furniture geometry, rounded boxes, clay material |
| `collision.mjs`, `doors.mjs`, `door-kinematics.mjs`, `levels.mjs`, `door-label.mjs` | Placement checks; door/level support (unused by the demo room). `door-kinematics.mjs` is the single motion contract for door rendering, the collision sweep and live collision |
| `rooms.mjs`, `room-picker.mjs` | The single synthetic room's config and the "About this room" dialog |
| `i18n.mjs`, `localize-ui.mjs` | Six-language strings |
| `controls.mjs`, `share-client.mjs`, `telemetry.mjs` | Screen-relative nudging, share loading, opt-in telemetry |
| `worker.mjs`, `metrics.mjs`, `serve.mjs` | Share API handler and the local-only server (in the repository, but excluded from the static `public/` and `release-public/` output) |
| `build_public.py`, `scripts/build-release.mjs` | Allowlisted static build and bundled release |
| `scripts/generate-demo.py` | Deterministic synthetic room generator |
| `skills/blender-room-tour/` | Portable Blender room-tour skill (see its `SKILL.md`) |
| `tests/` | Node, Python and browser smoke tests |
| `docs/` | Development guide, asset provenance and preview |

## Blender skill

To build your own room from footage or screened still images you are allowed to use, copy [`skills/blender-room-tour/`](../skills/blender-room-tour/SKILL.md) anywhere and follow its `SKILL.md` and `reference.md`. It needs Blender, plus FFmpeg only for extracting video frames. It does not upload anything or call any AI or cloud API.

`scripts/import-skill.py` can import a verified build into a fresh local copy of this app (single level, schema-2 `interaction.json` in Blender coordinates). That copy is served with `ROOM_PUBLIC_DIR=… ROOM_RECEIPT=… node serve.mjs`. Importing does not publish anything or establish fidelity. Before sharing a model, check it against the source yourself and make sure you have the right to share it.
