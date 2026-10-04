# Set up blender-room-tour

For a coding agent (Claude Code or Codex) helping a person turn their own walkthrough into an editable Blender room. Read this whole file before you act.

Status: published. Use the official `jt-wang/move-room-playground` repository and its `blender-room-tour.zip` Release asset.

## 1. Confirm the scope

Setup means one ZIP download, one skill folder inside this project, and a read-only requirements check. If the person asked you to set it up, proceed within that scope. If they only asked to read this guide, explain those steps and ask before installing. Change nothing outside the project.

## 2. Requirements

- Python 3.11+
- Blender (a standard install; its bundled glTF exporter is used)
- FFmpeg and ffprobe, only for video. Screened still images need only Python and Blender.

If a tool is missing, report it and stop. Don't install or upgrade anything yourself. The person installs missing tools through the official installers.

## 3. Get the whole skill folder

Install from the official repository, from your project directory:

```sh
npx skills add jt-wang/move-room-playground --skill blender-room-tour -a claude-code   # or: -a codex
```

Don't add `-g`; it installs globally. For manual setup, download `https://github.com/jt-wang/move-room-playground/releases/latest/download/blender-room-tour.zip`.

Compare the downloaded ZIP SHA-256 with the value in the GitHub Release notes or [`/source/version.json`](/source/version.json) on this site.

**Placement.** Extract the complete folder and keep all files and subfolders in their original locations. Use the folder that contains `SKILL.md`, named `blender-room-tour`, at the project path for your agent:

- Claude Code: `.claude/skills/blender-room-tour/`
- Codex: `.agents/skills/blender-room-tour/`

If that folder already exists, stop and ask; don't overwrite it. Never extract into a global skills folder in the home directory.

## 4. Read, then check

Read `SKILL.md` and `reference.md` in the skill folder completely ([reference](/source/skill-reference.md)). Then, from the skill folder:

```sh
python3 scripts/blender-tour doctor            # walkthrough video
python3 scripts/blender-tour doctor --stills   # already screened still images only
```

Report any blocker and stop. Setup ends here. Don't build anything until the person provides a source and asks for a room.

## 5. When the person asks for a room

- Use only a walkthrough video the person filmed or may use, or still images they have privacy-cleared. With video, `screen-references.py` copies only the frames they approve.
- Follow `SKILL.md`: write real observations from the images you opened, author the recipe, build, review the renders against the source pixels, record verdicts and fix the recipe until the review passes or the gaps are stated.
- They get an editable `.blend`, review renders and a local viewer on `127.0.0.1`. The geometry is estimated from the footage, not measured. This isn't an automatic or perfect scan, and you mustn't describe it as one.

Starter prompt:

> Use blender-room-tour to turn this walkthrough video into an editable 3D room I can explore.

## Keep private things private

Keep the raw video, unapproved frames and job folders outside the skill folder. Never put them, or any secrets or tokens, into a commit, release or shared package.
