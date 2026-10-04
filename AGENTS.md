# Contributor notes

- Browser code is plain ES modules served as-is from `public/`; `release-public/` is an esbuild bundle of the same files. New browser files must be added to `ALLOWLIST` in `build_public.py`, or the build refuses them.
- The demo room comes only from `scripts/generate-demo.py`. Change the generator, run `npm run generate:demo`, and commit the regenerated assets. Do not add models, photos or floorplans of real places.
- Keep every UI string in all six languages (`i18n.mjs`, `room-picker.mjs`).
- Never point the app at remote hosts or add analytics. Telemetry stays opt-in and same-origin.
- Before sending changes, run `npm test` and `npm run test:py`. Run `npm run test:browser` too when you change UI or rendering.
- `skills/blender-room-tour/` is a self-contained skill; see its `SKILL.md` for its own rules and tests.
