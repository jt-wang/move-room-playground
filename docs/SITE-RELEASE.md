# Site and release

The public repository and skill Release are available on GitHub. Website deployment uses separate approved media and existing hosting bindings. The v2.1 playground runtime and the `blender-room-tour` skill are byte-identical to the tested v2.1 version. The site build adds files around them and changes neither.

## What gets built

| Output | Contents |
| --- | --- |
| `release-public/` | The v2.1 playground bundle (`npm run build`), checked against `release-receipt.json` |
| `site-dist/` | The learner site (`npm run build:site`), checked against `site-receipt.json` |

`site-dist/` is an exact allowlist:

| Path | Source |
| --- | --- |
| `/` (`index.html`, `landing.css`, `landing.js`) | `landing/` |
| `/setup.md` | `landing/setup.md`, the guide agents follow |
| `/playground/palette.css`, `/playground/palette.js` | `landing/palette.*` |
| `/assets/default-room.png`, `story.mp4`, `story-portrait.mp4`, `story-poster.jpg`, `story-poster-portrait.jpg` | `MOVE_MEDIA_DIR`, checked against the external `MOVE_MEDIA_MANIFEST` |
| `/play/…` | `release-public/` byte-for-byte, except that `play/index.html` gains the palette stylesheet, script and review bar |
| `/source/blender-room-tour.zip` | `MOVE_SKILL_ZIP` |
| `/source/move-room-playground.zip` | `MOVE_SOURCE_ZIP` |
| `/source/skill-reference.md`, `README.md`, `LICENSE` | `skills/blender-room-tour/reference.md`, root `README.md`, root `LICENSE` |
| `/source/version.json` | Generated: version, ZIP hashes, playground receipt hash and publication state |

The source ZIP holds code and the invented practice room only. Approved-media fingerprints and internal real-room acceptance scripts stay outside the source checkout and export. The required media manifest is a private build input, never committed or bundled. The approved story film and hero image are never part of it or of this repository. The site build receives them separately through `MOVE_MEDIA_DIR` and copies them unchanged.

## Build

```sh
npm ci
npm run build            # release-public/ (must not be built with ROOM_TEST_HOOKS=1)
MOVE_MEDIA_DIR=/path/to/approved-media \
MOVE_MEDIA_MANIFEST=/private/path/to/approved-media.json \
MOVE_SKILL_ZIP=/path/to/blender-room-tour.zip   MOVE_SKILL_SHA256=<sha256> \
MOVE_SOURCE_ZIP=/path/to/move-room-playground.zip MOVE_SOURCE_SHA256=<sha256> \
npm run build:site
```

The build refuses, and leaves any previous `site-dist/` in place, when:

- an input is missing, is a symlink or is not a regular file;
- a hash differs: media against the external `MOVE_MEDIA_MANIFEST`, ZIPs against the explicitly supplied `*_SHA256`, or `release-public/` against its receipt;
- the skill ZIP doesn't hold exactly the files of `skills/blender-room-tour/`, byte for byte (so a stale ZIP fails);
- the source ZIP's `README.md`, `LICENSE`, `app.mjs`, `worker.mjs`, `SKILL.md` or `reference.md` differ from this checkout;
- the source ZIP has build, job, secret or OS-trace entries (`node_modules`, `.shares`, `jobs`, `private`, `site-dist`, `.env`, `__MACOSX`, …), or any image, model or video other than the generated practice-room assets;
- the landing's GitHub controls or the `setup.md` status line disagree with `landing/publication.json`;
- a served text file contains a local path, a source map reference, or (on the landing) a hardcoded `move.jingtao.io`.

It only replaces a `site-dist/` that has its own `.move-site-build` marker.

## Local install test

From an empty project directory, with the site served:

1. Download `/source/blender-room-tour.zip` and compare its SHA-256 with `/source/version.json`.
2. Extract it so that `SKILL.md` sits at `.claude/skills/blender-room-tour/SKILL.md` (Claude Code) or `.agents/skills/blender-room-tour/SKILL.md` (Codex).
3. Run `python3 scripts/blender-tour doctor` there (`doctor --stills` for screened images only).

Or paste the instruction from the landing's Get started panel into the agent. It points at this server's `/setup.md`.

## Preview

```sh
npm run serve:site                                     # 127.0.0.1 only, random port
PORT=64358 MOVE_PREVIEW_HOSTS=<interface-ip> npm run serve:site
```

`serve-site.mjs` serves only files listed in `site-receipt.json`. It refuses symlinks and extra files, rechecks hashes, and supports `HEAD` and single byte ranges for the film. It accepts only Host headers that name its own listen addresses. `MOVE_PREVIEW_HOSTS` takes comma-separated IP addresses of this machine's interfaces, for an authorized private preview. Wildcard addresses are refused. Shares go to `.shares/`, outside the served folder. No telemetry is enabled. Stop it with Ctrl-C or SIGTERM.

## Routing (`site-worker.mjs`)

| Request | Result |
| --- | --- |
| `/` | Landing |
| `/?s=…`, `/?room=…` (old share and room links) | 302 to `/play/` with the same query |
| `/play` | 301 to `/play/` |
| `/playground`, `/playground/` | 302 to `/play/` |
| `/play/…`, `/assets/…`, `/source/…`, `/setup.md`, `/playground/palette.*` | Static files |
| `/api/…` | `worker.mjs`, unchanged (Origin checks, limits, telemetry off unless enabled) |
| `/play/api/share[/<id>]` | The same `worker.mjs` share handler |
| Anything else | 404, never the landing |

For asset bindings that omit `Content-Length` inside the Worker, supply a `MEDIA_SIZES` JSON binding mapping each served video path to its verified byte count. The adapter streams valid single-byte ranges and leaves the video bytes unchanged. Keep these deployment inputs outside the public source.

The old `/#layout=…` links are forwarded to `/play/` by `landing.js`. With the existing playground service bound, root-level playground assets and its old app/style URLs still resolve for cached pages and old links; the landing media paths stay with the new site.

## Publication and deployment procedure

1. Publish only the reviewed clean source under `jt-wang/move-room-playground`, never a private working directory or old history.
2. Publish a release whose asset is named exactly `blender-room-tour.zip`, the same bytes as `/source/blender-room-tour.zip`. The landing uses `releases/latest/download/blender-room-tour.zip`, so no version tag is hard-coded.
3. Only after both public URLs load: set `state` to `"published"` in `landing/publication.json`, and turn the two `data-release-url` spans in `landing/index.html` into `<a href>` links with the same URL. Remove their pending pills, the pending wording in the Get started panel and review bar, and the `Status: unpublished.` section of `landing/setup.md`. Then update the README status line and rebuild. The build refuses a half-switched state.
4. Deploy on the existing host. Route requests through `site-worker.mjs`, with `ASSETS` serving `site-dist/`. For the existing live homes, bind `PLAYGROUND` to the existing playground service: the adapter strips `/play` from playground requests and forwards both share API paths unchanged in origin, query and body. Keep that service's existing assets, share KV and limiters intact. This avoids moving its prepared homes or breaking old room/share IDs. Without `PLAYGROUND`, the adapter serves the clean v2.1 invented practice room and uses the existing `SHARES` API binding; that is the default local/source-demo mode. Do not replace the live multi-home service with the synthetic demo. No private production data belongs in this repository.
5. Smoke-test production: `/`, `/play/`, an old `/?s=<existing id>` link (it must open the same layout under `/play/`), `/?room=…`, a new share created and reopened, `/setup.md`, film range requests, and unknown paths returning 404.
6. From a clean directory, after publication, run `npx skills add jt-wang/move-room-playground --skill blender-room-tour` for each agent and check that `SKILL.md` lands in the project folder, then run `doctor`.
7. Keep the selectable landing palettes until a final palette is chosen. The existing playground is served unchanged through its service binding.
