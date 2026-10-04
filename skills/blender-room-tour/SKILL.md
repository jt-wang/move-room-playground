---
name: blender-room-tour
description: Use when turning a room or apartment tour video, or screened still images from one, into an editable Blender scene with separate walls, floor, furniture and declared doors plus a local rotatable browser preview, or when reusing this direct-Blender recipe flow (看房视频、房间视频、Blender 重建). Source-guided manual modeling with estimated dimensions and a recorded source-versus-render review; no photogrammetry, splat training, or automatic reconstruction.
---

# Video or screened stills to Blender room

You (the agent) inspect the source images and write a Blender Python recipe. The bundled helper runs it in your installed Blender, renders review views, and exports a model. You then compare those renders with the source pixels, correct your own recipe, and rebuild until the review passes or the gaps are stated.

**Output boundary:** one job gives an editable `room.blend`, review PNGs, a review manifest/sheet, and a localhost preview (`room.glb` + viewer). When this skill sits inside its parent app checkout (`app/scripts/import-skill.py` exists), that optional importer can turn a build plus `interaction.json` into a local furniture-app folder with working doors. Without the app, nothing is imported. Neither path promises that an arbitrary video or image set will reconstruct well, and neither produces a multi-home site.

Setup, commands, job layout, the recipe, interaction and review contracts are in [reference.md](reference.md). Run `python3 scripts/blender-tour doctor` first (`doctor --stills` if you only have images). To smoke-test without sources, use `example JOB` (or `example JOB --variant articulated` for doors and fixtures), then `build JOB`. If a tool is missing, report it as a blocker. Do not install or upgrade tools.

## Workflow

1. **Create the job from what you actually have.**
   - Video: `prepare VIDEO --out NEW_JOB`. For HDR, use `--decoder avfoundation` on macOS 15+, or an FFmpeg with `zscale`. Then run `scripts/screen-references.py` to copy only privacy-cleared frames into a new still-image job.
   - Already screened images: `stills IMAGE_DIR --out NEW_JOB`.
   Still-image jobs never need, name, or imply the raw video. Never claim you reviewed a continuous video, or give timestamps, when you only had stills.
2. **Inspect every reference image.** In `observations.md`, list every visible room, hall, wet area, balcony and connection, with the images that show it. Record whether each is in the user's requested scope, and its status. Record surfaces, separate objects, layout, door hinge sides and swing directions, and which dimensions are estimates. Skip the photographer, fingers and mirror duplicates. Fill `coverage.json` with the requested scope, every space (`modeled`, `unresolved`, `not_visible` or `missing`), and a reason for every image you do not match to a view.
3. **Author `recipe.py`** from those observations. Walls, floor and each major item get independent geometry and their own group. Never copy a layout from another job or from the examples. Use the `geometry` helpers, or equivalent geometry, so the features people recognise are real shapes:
   - a sink or basin is an opening with a hollow bowl;
   - a washer pan has a raised rim;
   - burners are round with pan supports;
   - shelves are separate boards, and cabinet fronts are separate with gaps;
   - floors show their plank direction and seams;
   - windows have sashes, rails and bars.
   A solid carcass under a sink fills the bowl, so model it as a shell. Check that each feature reads correctly in both a source-matched view and the roofless overview. Match each roofed view to the image it reproduces (`source_frames`, `spaces`, and `orientation: "portrait"` for phone frames). Never join sparse points into one textured sheet across furniture and walls. List every intentionally transparent material in `glazing`.
4. **Declare doors in Blender terms.** Each moving leaf or panel is its own group, with its EMPTY root on the hinge line. Frames, tracks and jambs are separate static groups. In `interaction.json` (schema 2), `angle` is in degrees counter-clockwise about Blender +Z seen from above. Bifold panels link with `parent`. Choose the sign from where the source shows the leaf opening, then confirm it in a `doors_open` render.
5. **Set `observations_reviewed: true` in `scene.json` only after you have actually looked**, then `build`. The default total build budget is 2 hours; multiroom closed/open review sets can take more than 30 minutes on CPU. An explicit `--timeout` overrides that budget. Fix ownership, pivot, camera or glazing failures in the recipe. `--preview` builds are diagnostic only. Acceptance needs the default final quality: 64 samples at 1920x1080, or the same size in portrait.
6. **Review against the source pixels, then correct.** Run `review JOB`. For every view in `review/<build>/manifest.json`, open the render PNG, any doors-open PNG, and each matched source image yourself, not descriptions of them. Record `opened`, a `verdict`, and concrete `defects` in `verdicts.json`. Check:
   - left/right order and wall adjacency, using the camera's projected positions or right vector, not world X;
   - fixture shape, proportions, doors and closets;
   - exposure. A `washed_out` or `too_dark` render whose source is not also flagged is a lighting defect. Change the recipe lights or the declared `review_lighting` policy, never the materials.
   Fix your recipe, rebuild, run `review` again, and recheck every previously failed view plus its adjacent views. Record each earlier defect in `resolved_defects`, and record the change in `iteration_note`. `review-check JOB` accepts only a complete, current, final-quality review. Any change to a source image, recipe, scene, coverage, interaction or build makes it stale. Passing hashes and group checks say nothing about resemblance. Never call estimated geometry a measured scan, and never give accuracy percentages.
7. **Reconcile scope before declaring done.** Getting a viewer working, or modeling one focus area, does not complete a whole-source request. Model the missing in-scope spaces, or mark them `unresolved`/`not_visible` with the reason. If the user explicitly asked for partial scope, that scope can be complete.
8. **Deliver.** Give the `.blend` path, renders, review status and remaining limitations, and, when asked, the `serve` URL or the optional import command. `serve` binds 127.0.0.1 on a random free port and serves only the public allowlist. Before anyone shares a model publicly, a person must check it visually against the source, review any embedded texture pixels and image metadata, and confirm they have the right to share it.

The `example` command creates an explicitly synthetic job (invented geometry, no sources) for smoke-testing the toolchain. It cannot be marked as observed, and it cannot be reviewed or accepted.

## Improving this skill

Keep room-specific facts (dimensions, placements, image names) in the job, not here. The review files record each failure and correction: the image, the fix, and the views rechecked. Promote a correction into this file only if it was verified and applies beyond that room, and state the conditions under which it holds. Keep untested ideas as proposals in the job notes. For helper changes, rerun `python3 -m unittest discover -s tests` and the smoke commands in reference.md.
