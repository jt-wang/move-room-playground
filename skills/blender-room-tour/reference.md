# blender-room-tour reference

## Requirements

- Python 3.11+ (standard library only).
- Blender with the bundled glTF exporter (a standard install). Renders use Cycles on the CPU. No GPU or add-ons are needed.
- Still-image jobs (`stills`, or `screen-references.py` output) need only Python and Blender; check them with `doctor --stills`.
- Optional import into the parent app: Node.js 20.11+ to run `serve.mjs`. No npm install is needed to serve an imported folder.
- FFmpeg and ffprobe (only for `prepare`). Optional: an FFmpeg build with the `zscale` filter (zimg) is needed only for HDR or Dolby Vision sources, such as many phone videos. Without it, SDR videos still prepare normally and HDR videos fail with a clear error. `doctor` reports `zscale` as a warning and does not change its exit code because of it. As a workaround, export an SDR copy of the video with another tool you already have, and prepare from that.

Tools are looked up in this order: an explicit env var (`BLENDER_BIN`, `FFMPEG_BIN`, `FFPROBE_BIN`), then `PATH`, then (Blender on macOS only) `/Applications/Blender.app/Contents/MacOS/Blender`. An env var that points at a missing file is an error, not a fallthrough. Nothing is downloaded or installed.

## Setup

Install with `npx skills add jt-wang/move-room-playground --skill blender-room-tour`, then ask your agent to use `blender-room-tour` with your video. The installer includes the helper scripts, viewer assets and license.

Copy the entire `blender-room-tour` folder to any directory, keeping its scripts and assets together. Ask your coding agent to read `SKILL.md` there; no global skill installation or separate project checkout is required. Install the requirements through their official installers if they are not already available, then run `doctor`. Keep video jobs outside the skill folder.

Tested here with Python 3.14.5, Blender 5.2.1 LTS, and FFmpeg 8.0.1 on macOS. Other operating systems and Blender versions have not been tested.

## HDR setup

Check the exact executable selected by `doctor`. The HDR extraction path requires
both `zscale` and `tonemap`. An installed zimg library does not add zscale to an
FFmpeg binary built without it. Preparation rejects missing HDR filters before
creating a job; it never silently treats HDR pixels as SDR.

On macOS 15+, an explicitly selected native path uses Apple's installed
AVAssetImageGenerator with `dynamicRangePolicy = .forceSDR`, then draws the returned
image through a color-managed sRGB CGContext and writes a quality-0.95 JPEG. Apple
converts PQ/HLG transfer to 709 while retaining source primaries; the CGContext step
performs the subsequent primaries/profile conversion. It does not relabel HDR as SDR.
The output EXIF ColorSpace is sRGB (1). Portrait rotation is applied. Requested and
actual timestamps, output dimensions, and generated content headroom are recorded.

```sh
python3 scripts/blender-tour prepare VIDEO --out NEW_JOB --frames 32 --decoder avfoundation
```

This path needs macOS 15+, the already-installed Swift compiler/Xcode command-line
tools, and ffprobe. It compiles bundled `extract_sdr.swift` in a temporary directory.
It installs nothing and changes no system settings. A restricted process sandbox may
block Apple's video decoder; use the host's normal local execution permission rather
than changing security settings. If native extraction fails, the job remains failed.
There is no silent decoder fallback. This candidate was exercised on macOS 27.0,
including a PQ synthetic clip and an HLG/Dolby Vision phone video; other macOS
versions and HDR profiles remain unverified. Visually inspect the produced frames.

The original FFmpeg route still needs zscale and tonemap. Homebrew's separate
`ffmpeg-full` formula is one possible source, but do not install it automatically.
On this Mac its dry run proposed 21 dependency upgrades and a new llama.cpp dependency,
so it was not installed. Native extraction avoided those changes.

Sources: https://developer.apple.com/documentation/avfoundation/avassetimagegenerator/dynamicrangepolicy-swift.struct/forcesdr
and https://ffmpeg.org/ffmpeg-filters.html#zscale .

## Commands

Run from the skill directory, or give the script's full path. Every file is resolved relative to the script.

```sh
python3 scripts/blender-tour doctor [--stills]
python3 scripts/blender-tour prepare VIDEO --out JOB [--frames 12] [--long-edge 1920] [--decoder avfoundation]
python3 scripts/screen-references.py RAW_JOB --keep frame_001.jpg,frame_004.jpg --out JOB   # cleared frames only
python3 scripts/blender-tour stills IMAGE_DIR_OR_FILES... --out JOB    # already screened images, no video
python3 scripts/blender-tour example JOB [--variant basic|articulated] # synthetic job, no sources
python3 scripts/blender-tour build JOB [--timeout 7200] [--samples N] [--resolution 1920x1080] [--preview]
python3 scripts/blender-tour verify JOB
python3 scripts/blender-tour review JOB                  # manifest, sheet and verdict template for the current build
python3 scripts/blender-tour review-check JOB            # accepts only a complete, current review
python3 scripts/blender-tour serve JOB                   # prints http://127.0.0.1:PORT/ ; Ctrl-C stops
python3 -m unittest discover -s tests                    # no Blender/FFmpeg needed
```

`build` runs `blender --background --factory-startup --python blender_export.py -- config.json` as one child process. On timeout, the helper kills only that process. Each build goes into a new `JOB/builds/<timestamp>/` directory, and `state.json` points at the latest successful build. A finished build prints its render tier and that it is not visual acceptance.

The default total build budget is **2 hours (7200 seconds)**, for both the CLI and Python API. Full-quality multiroom jobs can exceed 30 minutes because every requested closed/open view is rendered on CPU. Plain `build JOB` uses this budget; no special override is needed for the evaluated 25-view job. `--timeout SECONDS` remains an explicit total limit, including shorter limits. Slower machines or larger jobs may still require a longer budget. On timeout, the failed build and partial PNGs stay on disk, but this version has no resume command and saves the model only after all renders finish. A retry creates a separate build; never describe an incomplete build as exported.

Render quality: source jobs (video or stills) default to 64 samples at 1920x1080, with a floor of 16 samples and 1280 px width. Only builds with at least 64 samples and 1920x1080 pixels (landscape, or the same size for `portrait` views) are tier `final`. Everything else, including `--preview` (16 samples, 1280x720 by default), is `diagnostic_preview`, is labelled as such in the review sheet, and cannot be accepted. Synthetic jobs default to 8 samples at 480x270 so the smoke build stays fast.

## Screened stills and privacy scope

`screen-references.py` copies only the frames you name, after a person has visually screened them, into a new `kind: "stills"` job. It records each image's SHA-256, plus only the video's hash, duration and extraction method as provenance. The video path, stream tags and unselected frames are not copied. `stills` does the same for images you already have. Neither command detects faces, text or metadata; the selection is a claim by whoever made it. The build refuses a stills job if any listed image changes, or if an unlisted file appears in `references/`. Review statements say "N screened still images; no continuous video was available or reviewed". Keep the raw video and unapproved frames outside the agent's folder.

## Review gates

A video job only builds when all of these hold:
- `scene.json` has `observations_reviewed: true`
- the source video still matches its SHA-256
- `observations.md` and `recipe.py` both differ from the templates that `prepare` wrote

A still-image job builds under the same `observations_reviewed` and template gates, and the hashes of its reference images replace the video hash. A synthetic job (`kind: synthetic` in metadata.json) must have no source and no references, and must keep `observations_reviewed: false`. A video or stills job can't be relabeled as synthetic to skip the gates.

## Job layout

```
JOB/                      private: never served
  metadata.json           kind, source hash (video) or image hashes (stills), frame list
  references/  reference-sheet.html
  observations.md  recipe.py  scene.json  coverage.json  interaction.json (optional)  state.json
  builds/<id>/
    room.blend  renders/*.png  checks.json  summary.json  blender.log  config.json  receipt.json
    public/               the only directory `serve` can read
      index.html viewer.js playcanvas.min.js PLAYCANVAS-LICENSE.txt room.glb viewer.json
  review/<build-id>/      manifest.json  sheet.html  verdicts.json (you edit)  check.json
  review/acceptance.json  written only by a passing review-check
```

`serve` returns exactly those six public files over 127.0.0.1. It rejects every other path, symlinks, and requests with a foreign `Host` header. There is no option to expose it on the network. `verify` re-checks every artifact hash and that `public/` contains exactly the allowlist.

Before publishing `room.glb`, the build removes glTF `extras` and the exporter's generator string. It renames meshes, images, and textures to generic indexes, and it refuses any GLB that references external images or buffers. Node names (group IDs and object names), material names, group labels, view labels, notes, and the scene title stay visible in the preview. Keep them generic, with no addresses, people, or file names. The build fails if any of them contains the job path, the home directory, or the source video's file name. `scene.json` `title` defaults to "Room model".

Projected textures are embedded in the public GLB, including their pixels and image metadata. Review them for faces, documents, identifying details and metadata before sharing. `checks.json` records texture count and bytes; `verify` reports them when present. Source texture names are replaced, but the image content is retained.

## Recipe contract

`recipe.py` is trusted Python that runs inside Blender with `JOB_ROOT` (a `pathlib.Path`) injected. `build_scene()` creates objects in Blender Z-up meters and returns:

```python
{
  "groups": {"RoomFloor": ["Floor"], "RoomWalls": ["Wall_N", "Wall_W"],   # required, nonempty
             "RoomCeiling": ["Ceiling"],                                  # optional, hidden in preview
             "Sofa_01": ["Sofa_Base", "Sofa_Back"]},                      # >= 1 furniture group
  "labels": {"Sofa_01": "Sofa"},                     # optional display names
  "glazing": ["Window_Glass"],                       # every material meant to be transparent
  "views": [{"name": "Entrance", "position": [0, -4, 1.6], "target": [0, 0, 1.2],
             "lens": 24, "label": "Entrance", "cutaway": False,
             "source_frames": ["frame_003.jpg"],   # reference image(s) this view reproduces
             "spaces": ["corridor"],               # coverage.json space ids it shows
             "adjacent": ["Kitchen"],              # optional extra views to recheck with it
             "orientation": "portrait",            # renders 1080x1920 at final quality
             "doors_open": False}, ...],           # True adds VIEW__doors_open.png
  "review_lighting": {"camera_fill": "auto"},       # optional; see Review lighting
  "separations": [{"a": "Sofa_01", "b": "RoomWalls", "axis": 1, "min_gap": 0.02}],  # optional
  "notes": ["Ceiling height estimated at 2.6 m; north wall unseen."]   # required
}
```

Every mesh or curve object belongs to exactly one group. The build moves each group root and fails if any other group moves with it. Glazing uses Principled BSDF Alpha below 1, which exports as glTF `alphaMode: BLEND`. The viewer does not override materials. Unknown view keys are rejected, so a typo cannot silently drop a source match. The review metadata (`source_frames`, `spaces`) stays private; `viewer.json` gets only camera poses and labels.

`examples/synthetic_room.py` (under `scripts/blender_tour_flow/`) is a minimal working recipe for an invented room. `examples/articulated_room.py` plus `articulated_room.interaction.json` is an invented room with a plank floor, a sash window, an open-shell kitchenette with a hollow inset sink, round burners and separate fronts, open shelves, and hinged, sliding and bifold doors.

### Geometry helpers

`from blender_tour_flow import geometry as g` inside a recipe gives these helpers:

- `material`, `box`, `boxes`, `cylinder`, `ring`, `wall`
- `inset_basin`: a worktop with a real opening and a hollow basin; keep the carcass below it a shell
- `hollow_pan`: a raised-rim tray
- `gas_burner`: tray, crown ring, cap and pan supports
- `open_shelves`, `cabinet_fronts`: separate fronts with gaps and handles
- `plank_floor`: plank direction, staggered joints and real seams over a darker underlay
- `sliding_window`: sashes on two tracks, transom rails, fall bars and a sill
- `door_frame`; `hinged_leaf`, `sliding_leaf`, `bifold_pair` (correct roots and suggested interaction parts)

All dimensions are arguments; the helpers encode no real room. The app collides with one bounding box per exported object, so `wall` and `door_frame` emit each strip, jamb and head as its own object (`separate_boxes`), all in one group; packing disconnected strips around an opening into one mesh would make the doorway a solid obstacle. Do the same in hand-written recipes. A feature that only looks right from one camera (a flat inset plate standing in for a sink, a single slab standing in for two burners) fails the roofless overview check.

## Review lighting

Review renders use Cycles with AgX (or Filmic/Standard) and look `None`. The materials the recipe authored are never changed, and nothing whitens or tone-maps them beyond that view transform. For roofed (non-cutaway) views in a room with a `RoomCeiling`, the default `camera_fill: "auto"` adds a small review-only area light at the camera, but only when the recipe has no interior point/spot/area lights. Its energy is `8 x distance^2` W, clamped to 10-160 W, which is roughly 2.5 W/m2 on axis. That default is uncalibrated. The light is removed before the `.blend` is saved and the GLB is exported.

`review_lighting` may set `camera_fill` (`auto`, `on`, `off`), `fill_scale` (0.1-2) and `film_exposure` (-2 to 2 stops). Any non-default value needs a written `reason`. The resolved policy, the fill actually used, and the interior-light count are recorded per view in `checks.json` and shown in the review sheet.

After each render the build measures the stored pixels' luma (p05, p50, p95, clipped share) and the same statistics for every matched source image. It flags a view as:

- `washed_out`: p05 >= 0.66 or more than 30% clipped
- `too_dark`: p50 < 0.12 or p95 < 0.30
- `low_contrast`: p95 - p05 < 0.15
- `near_occluder`: 5% or more of a 9x9 ray grid hits geometry within 0.5 m of the camera

These are deterministic heuristics for directing review, not resemblance scores. `review-check` blocks a `washed_out` or `too_dark` render unless every matched source image has the same flag, and then it still needs a written disposition. Every other flag needs a disposition.

## Doors and windows (`interaction.json`, schema 2)

Author doors in the same Blender Z-up metres as the recipe:

```json
{"schema_version": 2, "coordinates": "blender-z-up", "id": "my-room",
 "bounds": {"min": [-0.1, -0.1, 0], "max": [5.0, 3.5, 2.55]},
 "doors": [
  {"id": "entry", "kind": "door", "ordinal": 1, "parts": [{"name": "EntryDoor", "angle": 90}]},
  {"id": "pantry", "kind": "door", "ordinal": 2, "parts": [{"name": "PantrySlider", "slide": [0, -0.8, 0]}]},
  {"id": "closet", "kind": "door", "ordinal": 3, "parts": [
    {"name": "ClosetFoldA", "angle": 80},
    {"name": "ClosetFoldB", "angle": -160, "parent": "ClosetFoldA"}]}]}
```

These values come from the invented example; use your own model's groups and estimates.

- **Angle sign.** `angle` is in degrees counter-clockwise about Blender +Z, seen from above (right-hand rule): +90 turns a leaf that extends along +X so it extends along +Y. Choose the sign from the side the source shows the leaf opening into. Do not flip it to make an animation look plausible.
- **Slide.** `slide` is a Blender-space travel vector of at most 4 m.
- **Linked panels.** `parent` links a panel to another part of the same door. The child's hinge rides on the parent's moving panel. For equal bifold panels, use `angle: a` and `angle: -2a`, so the free edge stays on the track.
- **Ownership and pivots.** Each part is its own group, with its EMPTY root on the hinge line; `geometry.hinged_leaf`/`bifold_pair` place it there. Frames, tracks and jambs are separate static groups and never move.

The build checks schema-2 files before Blender starts. It rejects duplicate part names, cycles, missing or cross-door parents, invalid angles and slides, and room groups used as parts. Inside Blender it refuses a hinge pivot that is not on its own panel, or a linked pivot that is not on its parent panel, because those panels would separate. `checks.json` records each part's closed bounds and fully open corners. Views with `doors_open: true` also render with every door fully open, using the same motion contract as the app.

Blender `(x, y, z)` is web `(x, z, -y)`, so a Blender +Z rotation is the same signed rotation about web +Y. The importer writes it as an explicit `yaw`, and the app applies `yaw` unchanged to rendering, the collision sweep and live collision. Older schema-1 files (web-space `angle`, which the app negates) are legacy. The build ignores them, and the importer accepts them only with `--legacy-v1-interaction`, to reproduce an old import unchanged.

## Review contract

`review JOB` verifies the current build and its inputs, then writes `review/<build>/manifest.json` and `sheet.html`. For each view it lists:

- the render path and SHA-256, and the doors-open render if any;
- each matched source image and its hash;
- exposure statistics, the lighting used, near-occluder share and flags;
- previously failed views, the views to recheck (failed views plus views sharing a space or declared `adjacent`), and every earlier defect.

It also writes a pending `verdicts.json`. For every view, fill in:

```json
"Kitchen": {"render_sha256": "<prefilled>", "opened": {"render": true, "sources": ["frame_006.jpg"]},
            "verdict": "pass", "defects": [],
            "resolved_defects": {"sink-flat": "Basin is now a hollow bowl; checked Kitchen and Overview"},
            "flag_dispositions": {"near_occluder": "Source has the same door edge in the foreground"}}
```

When the view also has a doors-open render, the template adds `"doors_open_render_sha256"` (prefilled), `opened.doors_open_render: false` and `"doors_open_verdict": "pending"`. Open that image too: check the swing side, that bifold panels stay joined and fold onto the track, and that no leaf passes through a wall. Then set both to `true`/`"pass"`. A correct closed render never vouches for the open pose.

Defects are `{"id", "category", "description", "status"}`. The category is one of geometry, proportion, fixture_detail, material, lighting, camera, door, coverage, other; the status is open, fixed or unresolved. Set `iteration_note` whenever an earlier review exists.

`coverage.json` declares the requested scope:

```json
{"schema_version": 1, "requested_scope": "Every space visible in the supplied images",
 "spaces": [{"id": "kitchen", "label": "Kitchen", "in_scope": true, "status": "modeled", "evidence": ["frame_006.jpg"]},
            {"id": "bath", "label": "Bath", "in_scope": true, "status": "not_visible", "note": "No supplied image shows it"}],
 "unmatched_frames": {"frame_009.jpg": "Same corner as frame_008.jpg"}}
```

`review-check JOB` writes `review/acceptance.json` only when all of the following hold:

1. The build is tier `final`, and no source image, metadata, observations, recipe, scene, coverage, interaction or build file changed since the manifest.
2. Every view's verdict is `pass` for its exact render. The render and every matched source were marked opened, and every roofed view has a matched source. Every doors-open render was opened and has `doors_open_verdict: "pass"` for its exact hash.
3. No defect is open or unresolved. Every earlier defect is listed in `resolved_defects`, and every previously failed view still exists.
4. Exposure and occlusion flags are handled as described under Review lighting.
5. Every in-scope space is modeled and shown by a source-matched view, or is `unresolved`/`not_visible` with a note. `missing` blocks acceptance.
6. Every reference image is matched to a view or listed in `unmatched_frames` with a reason.

The acceptance lists non-modeled spaces as limitations and records each iteration. It states that it is a model-author visual review, not a measurement or fidelity certification. Every review-check outcome is appended to `review/history.json`; nothing earlier is deleted. `verify` and the importer report `accepted` only while all of these hold:

- the current review still evaluates clean, which includes re-running the build gates (rehashing the video or every still image);
- `acceptance.json` matches the current build, inputs, manifest and verdict files, including earlier builds' verdicts;
- the latest review-check for this build passed with those same records.

Otherwise they report `stale`. Editing a verdict to `fail`, or a failed review-check, therefore revokes an earlier pass until review-check passes again.

## Optional import into the parent app

This applies only when the skill is inside its app checkout (`app/skills/blender-room-tour`):

```sh
python3 app/scripts/import-skill.py --job JOB --interaction JOB/interaction.json --out NEW_APP_DIR
ROOM_PUBLIC_DIR=NEW_APP_DIR ROOM_RECEIPT=NEW_APP_DIR-receipt.json node app/serve.mjs
```

The importer verifies the build receipt, re-checks the schema-2 contract and the hinge/link pivots from the exported GLB nodes, and refuses scaled, matrix or invalid part transforms and external URIs. It copies only the app allowlist and prints the build's review status. Importing is a functional step; it does not repair geometry or establish fidelity.

## Browser checks

When the viewer is ready it sets `window.roomViewer.ready === true`. After each interaction, `window.viewerState` holds the camera position, distance, selection, and the visible groups. Use these with Playwright or a similar tool, and also look at the screenshots yourself.

## Notices

`playcanvas.min.js` is the PlayCanvas engine (MIT). Its notice, `PLAYCANVAS-LICENSE.txt`, ships with every preview. The rest of this skill's code is MIT-licensed by Jingtao Wang; see [LICENSE](LICENSE). The preview's `viewer.js` carries the same notice in its header comment.
