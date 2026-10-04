# Move

**I had no 3D background. AI coding agents built [18 rooms](https://move.jingtao.io/play/) in Blender from my videos and floor plans. The first attempts failed; a review loop made them usable. This repository packages that loop as a skill for Claude Code and Codex.**

[Try the rooms](https://move.jingtao.io/play/) · [Download the skill ZIP](https://github.com/jt-wang/move-room-playground/releases/latest/download/blender-room-tour.zip) · [Agent setup guide](https://move.jingtao.io/setup.md) · [Follow @thejingtao](https://x.com/thejingtao)

## Install the skill

```sh
npx skills add jt-wang/move-room-playground --skill blender-room-tour
```

Works with Claude Code and Codex. For manual installation, download and copy the whole [`skills/blender-room-tour/`](skills/blender-room-tour/SKILL.md) folder into your project (`.claude/skills/` for Claude Code, `.agents/skills/` for Codex). [Setup](skills/blender-room-tour/reference.md#requirements).

Then ask your agent:

> Use blender-room-tour to turn this apartment video into an editable 3D model I can explore.

Your agent reviews the footage, builds in Blender, and checks the model against the video. The geometry is estimated from the footage, not a measured scan.

## What the loop is

The agent pulls reference frames, writes down what it sees, turns those notes into a Blender recipe, builds, renders, and compares the renders with your video. You read its notes, point at what drifted, and it fixes the recipe. Expect a few rounds. The method carries over to other work you don't know yet: [what it taught me](https://move.jingtao.io/#lessons).

![Move’s included practice room](docs/preview.png)

## Build and preview locally

```sh
npm ci && npm run build      # the playground, bundled into release-public/
npm run build:site           # learner site in site-dist/; needs the inputs in docs/SITE-RELEASE.md
npm run serve:site           # http://127.0.0.1:PORT/ ; the playground is at /play/
```

This repository holds code and one invented practice room. The story film and hero image are supplied separately at site build time.

[Development](docs/DEVELOPING.md) · [Site and release](docs/SITE-RELEASE.md) · [Assets](docs/ASSETS.md) · [MIT](LICENSE)

By [Jingtao Wang](https://jingtao.io) · [Follow @thejingtao on X](https://x.com/thejingtao) for the next build.
