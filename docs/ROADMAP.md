# Scenecaster Roadmap

> A scene and asset editor that sits **beside** a hand-written (often AI-written) Phaser 4 project and touches it as little as possible.

**Written:** 2026-10-13. See also [ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md).
**Tulio sources read:** `SantasLair/tulio-editor` (V1 plan, export proposal, script-system plan, `projectModel/*`, `UndoRedoManager.ts`, `FileWatcherService.ts`) and the sample `Tulio-Bogyo`.

## Use case (the constraint that shapes everything)

1. **Manual scene editing:** the human places and tunes objects visually.
2. **AI-driven code:** an AI agent (Claude Code or similar) writes and changes the game code.
3. **Asset management:** the human uses the editor to add assets to the project.

The editor and the AI never talk to each other. They share **files**: the scene JSON and the assets folder. So the file formats are the product.

### Target projects

The roadmap is checked against the games in `E:\Gen-AI-Games\phaser-prototypes` (bannerwake, ember-keep, forge-editor-test, hexTiles-fantasy, keep-and-conquer, lords-of-kastrallia, mini-world, quick-civ-roguelite, tiny-realms, turnstead) and `D:\dev\Phaser` (Auto-Shooter-Survivor, Kastro-Via, dungeon-strategy). Survey findings (file listing and grep, not a code read):

- Mostly Vite + Phaser 4 (one Phaser 3.90), JS or TS, with `CLAUDE.md` architecture rules in several. Some forbid Phaser in the core, so scene-reading code belongs in the adapter layer.
- The games are largely procedural (hex maps, generated terrain). Hand-placed objects are rare today, so **visual scenes are assumed to be added**: title screens, HUDs, menus and battle staging.
- Assets live in `public/assets`, `assets` at the root, or a flat `public/` (up to 742 files), and several have their own import tools.
- Several projects have 2 to 5 scene classes, some running as overlays (UI over map).
- `dungeon-strategy` has no `package.json` at its top level. `Kastro-Via` already uses Phaser Editor 2D (`.scene` files, `asset-pack.json`) and is out of scope except possibly for asset import.

## Principles

1. **Zero footprint until you adopt.** Opening a project writes nothing. Saving a scene, importing an asset or changing a setting creates a `scenecaster/` folder (project file, scenes, asset manifest, a short format README). No changes to `package.json`, `src/`, `index.html` or the entry file.
2. **Anything that touches game code is opt-in and removable.** That includes generated code and any optional runtime file. There is no live bridge: the loop is edit, save, and the game's own dev server reloads the browser. Adopting a project (below) is the one deliberate exception: an AI, started by you, changes the game to read its settings, scenes and assets from `scenecaster/`. Unadopted projects stay untouched.
3. **Files are the API.** Scene and manifest formats are plain JSON: stable key order, readable names, small git diffs, documented in a `scenecaster/README.md` the AI can read. Names matter more than UUIDs for anything the AI has to reference.
4. **Safe with a second writer.** The AI and git change files while the editor is open. Watch, reload, never clobber. File watching is the integration; the editor and the AI do not need a live connection. (An optional local tool interface is a nice-to-have in Phase 6.) Known limit: file watching cannot see unsaved editor changes, so the editor prompts when a file changes under unsaved edits.
5. **Never edit the user's code.** The editor writes only inside `scenecaster/` and the assets folder. When a rename or move would break code references, it reports them. It does not rewrite code.
6. **No data loss, boring reload.** (Tulio's release gates.)
7. **One roadmap, small surface.** Anything needing its own panel family (animation, physics, particles) is out.

## What to borrow from Tulio

| Tulio idea | Verdict | Lite version |
|---|---|---|
| Release gates: no data loss, save failure keeps dirty state, reload is boring | **Yes, first** | Phase 1 |
| Export in four stages: model → validate → generate → verify | **Yes, adapted** | Validate-on-load (Phase 1); optional generated file (Phase 3) |
| Output should read like normal Phaser; thin helper only | **Yes** | Generated code is plain Phaser, never a runtime dependency by default |
| Command-pattern undo (`push({undo, redo})`) | **Yes** | Phase 1 |
| Polling file watcher for external edits | **Yes, now essential** | Phase 1; the AI is the "external editor" |
| Scene = file with `preloadAssets`, size, background | **Yes** | `scenecaster/scenes/<name>.scene.json` |
| UUID ids, `parentId`, `locked`/`visible`; **plus unique readable names** | **Yes** | Phase 1 |
| Object definition vs instance (prefabs) | **Later** | Phase 5 |
| Script property schema in the inspector, name-based references | **Optional, last** | Phase 6 |
| Layers | **Cut down** | Group by depth; existing scroll factor |
| Camera persistence, grid, align/distribute, recent projects | **Cheap ones** | Phases 1 and 4 |
| Playwright E2E with an ephemeral project | **Yes** | Phase 7 |
| Signals, GML helpers, `TulioBehaviour` lifecycle, own game loop | **No** | Engine features |
| Monaco, dock layout, Konva designer, hosted build, multi-engine export, monetization | **No** | Out of scope |

## Phases

Effort: **S** (under a day) · **M** (a few days) · **L** (a week or more).

### Phase 0 — Foundation (from the architecture plan)
- [x] **S** Script-name allowlist for `devserver:start` (command injection)
- [x] **M** Main validates every path against the opened project folder. This is the enforcement point for principle 5: writes are allowed only under `scenecaster/` and the assets folder.
- [x] **S** Check `ev.source` on `message` events (editor ↔ its own Phaser iframe)
- [x] **S** Fix `npm install` ERESOLVE (pin vite 7, or wait for a compatible electron-vite)
- [x] **M** Typed `protocol.ts` plus a single property-descriptor table
- [x] **S** Store selectors

### Phase 1 — A scene file you and an AI can both trust
- [ ] **M** Scene model in the renderer; Phaser is a view (architecture item 5)
- [ ] **M** Command-based history; add/delete/duplicate/rename become undoable
- [x] **S** Move scene storage to `scenecaster/scenes/<name>.scene.json`
- [ ] **S** **Naming:** the folder name is one constant in the editor. *(Partial: constant is `src/shared/layout.ts`; generated docs not started.)* `MIGRATE.md`, `check.mjs`, the README and the `CLAUDE.md` pointer are generated from it, so a future rename is a one-line change. The folder is a normal (not hidden) directory, because many search tools skip dot-folders.
- [ ] **S** AI-friendly format: relative asset paths, `version`, unique readable `name` per object, UUID `id` kept, `parentId`, stable key order, one object per few lines for clean diffs
- [ ] **S** Scene `key` field that must match the Phaser scene key, plus an `overlay` flag (the scene draws over another, so the editor shows a neutral backdrop and the canvas size comes from the game)
- [ ] **S** Project root discovery: Open Project finds the nearest `package.json` (e.g. `dungeon-strategy/game`) or lets you pick it; remembers it
- [x] **S** Write nothing on open. Today the canvas-size prompt writes `.phaser-forge.json` immediately; defer that until a setting changes or something is saved.
- [ ] **M** **`scenecaster/project.json`** *(Partial: file exists with canvas size and dev script only.)* (the project's metadata, read by both the editor and, once adopted, the game):
  - game settings: canvas size, scale mode, physics, background colour, Phaser version
  - scene registry: key, kind (`visual` / `logic` / `overlay`), layout file if any, boot order
  - scene flow: which scene starts or launches which
  - assets folder and dev script (replaces most of `.phaser-forge.json`)
- [ ] **M** **Project overview panel:** shows `project.json`; editing a setting writes it back. Before a project is adopted it shows detected values instead (scan of `new Phaser.Game({...})`, `super('key')`, `scene: [...]`, `scene.start/launch('key')`), marked "detected, not saved".
- [ ] **S** **Watch scene files and reload on external change** (AI or git). If the scene is dirty, prompt instead of overwriting.
- [x] **S** Dirty tracking; save failure never clears dirty; atomic write (temp file + rename); `.bak` of last good file. Run never saves implicitly: it prompts when the scene is dirty.
- [ ] **S** Validate on load: missing assets, duplicate names/ids, unknown kinds. Report in the UI.
- [ ] **M** **Scene list** = scene registry (or, before adoption, the scanned scenes) joined with `scenecaster/scenes/*.scene.json`. Each scene shows a state: *layout + code*, *code only* (greyed, no canvas; Boot, Preload, Audio...), or *layout only* (warning: no scene with that key). "Create layout" on a code-only scene; rename/delete apply to layout files only and warn if a code scene still uses the key. One layout per scene key.
- [ ] **S** *Optional:* scene flow view (Boot → Title → Game, UI launched over Game) drawn from the registry
- [x] **M** **Disable live mode** (decided: not used, and the browser reloads on file changes anyway). Switch it off behind one flag, default off, rather than deleting it: hide the embedded game iframe, edit overlay, Install Bridge UI and live inspector, and keep `src/bridge/` and the live-mode code in the repo, unused. Keep **Run dev server** with its console and an **Open in browser** link (see Phase 6). Move the live-only code out of the main `App.tsx` path so disabling it also removes its state from the design-mode code; this makes it easy to re-enable later. Update the README, which still advertises live mode.
- [ ] **M** Clean up `App.tsx` (architecture item 4), now design mode only: hooks for the project, the scene and the dev server instead of one 989-line component
- [ ] **S** Multi-select, copy/paste, arrow-key nudge, per-scene camera persistence, recent projects

### Phase 2 — Asset pipeline (your stated use case)
> The editor is the place assets enter the project; the AI reads the result. This phase serves every target project, so it can start before multi-scene support is finished.
- [ ] **S** **Assets folder auto-detection:** `public/assets`, `assets`, or `public`, overridable in `scenecaster/project.json`. The manifest stores both the file path (`public/assets/x.png`) and the URL the game loads (`assets/x.png`), because Vite serves `public/` from the site root.
- [ ] **M** Import: drag files from the OS (or a file picker) into the asset browser; copy into the project's assets folder; choose destination subfolder; handle name collisions
- [ ] **M** Asset kinds: image, spritesheet (frame width/height, margin/spacing; frames shown and pickable), atlas (JSON + image), audio (with preview), other
- [ ] **M** **`scenecaster/assets.json` manifest:** key, path, kind, frame config. The AI uses it to write `preload()`; scenes reference assets by key. Keys are auto-suggested from the filename and editable.
- [ ] **S** Rename/move asset updates the manifest and every scene file, and **lists code references** (grep of the project source) for the human or AI to fix. It does not edit code.
- [ ] **S** Delete asset with a usage check (scenes and code references)
- [ ] **S** Unused-asset and missing-asset report
- [ ] **S** Optional size warnings (oversized textures, non-power-of-two spritesheets)
- [ ] **S** Watch the assets folder, so files the AI or the human adds outside the editor appear

### Phase 3 — Hand-off to code and adopting existing projects
> Make it trivial for an AI to use the project file, scenes and manifest, and to convert an existing game to them. Pick the lightest option that works.

**Adopting an existing project** (AI-run, one project at a time, started by you):
- [ ] **M** `scenecaster/MIGRATE.md`: a prompt and checklist the editor writes for an AI to follow. Steps: create `scenecaster/project.json` from the game's real config and scene classes; extract **literal** placements (fixed x/y numbers) from scene code into layout JSON and leave computed or procedural positions alone; move asset loads into the manifest; make the game config, scene list and `preload()` read from `scenecaster/` (JSON imports bundled by Vite); keep behaviour identical; run the game or tests to check.
- [ ] **S** "Adopt this project" button: writes `MIGRATE.md`, shows the one-line `CLAUDE.md` pointer to add, and records `adopted: true` once the drift check passes. Nothing in the game is changed by the editor itself.
- [ ] **M** **Drift check**, on open and on file changes, with a copy-to-clipboard report for the AI: a scene class with no registry entry; a layout key matching no scene; an asset loaded in code that is not in the manifest; a manifest asset whose file is missing; a setting in `project.json` that the game config ignores.
- [ ] **M** **`scenecaster/check.mjs`:** a dependency-free script the editor writes into the project. `node scenecaster/check.mjs` prints the same validation and drift report as the editor and exits non-zero on problems, so an AI can check its own work without the GUI, and a git hook or CI can run it. It carries a version, and the editor flags a stale copy. The editor and the script share one validation source in this repo so they cannot disagree. No full CLI: edits stay direct file edits.
- [ ] **S** *Optional:* `check.mjs --fix-manifest` adds asset files found on disk to the manifest (for assets dropped in outside the editor)
- [ ] **S** The `CLAUDE.md` pointer says to keep `scenecaster/` in sync when changing scenes, assets or settings, to run `node scenecaster/check.mjs` afterwards, and to put scene-reading code in the adapter layer where the project requires it.
- [ ] **S** Pilot on one small project (`tiny-realms`, or `lords-of-kastrallia`) before the others; revise `MIGRATE.md` from what the AI got wrong.

**Hand-off to code:**
- [ ] **S** `scenecaster/README.md`, written by the editor: file formats, rules ("edit scenes via the editor or follow this schema"), and example loader snippets. A one-line pointer for the project's `CLAUDE.md`/`AGENTS.md` is offered, never inserted automatically.
- [ ] **S** JSON Schema for scene and manifest files (`scenecaster/schema/*.json`), referenced from each file via `$schema` so editors and AIs can validate
- [ ] **S** **Loader snippet in `scenecaster/README.md`:** about 30 to 60 lines of plain Phaser that build a scene's objects from its JSON (anchors, containers, text, nine-slice), to be copied into the project's scene or adapter layer. It is not an npm package and not an install step. Without it, an AI writes a different reader in every project; with it, they match and stay small.
- [ ] **S** **Dev shortcut convention** in the snippet and `MIGRATE.md`: the game reads `?scene=<key>` (dev only) and starts there. Vite does a full page reload when a scene file changes, which restarts the game, so this brings you back to the scene you are editing. Several target games already use query flags (`?solo=1`, `?seed=`).
- [ ] **M** "Copy as Phaser code" for one scene or selection (plain `this.add.*` calls)
- [ ] **M** *Optional:* generate `scenecaster/generated/<Scene>.ts` (typed object names/keys and positions, never hand-edited, deterministic output). Off by default.
- [ ] **S** **Scene preview image:** on save, write `scenecaster/previews/<Scene>.png` (git-ignored) so an AI can look at a layout without running the game
- [ ] **S** **Copy context for AI:** copies the selected object's name, scene, layout file and values as text for pasting into a prompt
- [ ] **S** "Copy for AI" button on the drift and validation reports
- [ ] **S** Decision point after adopting two or three target projects: is the snippet enough, or is a real loader file needed (Phase 6)? Also check how the reload loop feels (full reload, `?scene=`).

### Phase 4 — Object types that earn their keep
- [ ] **M** Image, Text, Container/Group (`parentId`), NineSlice (panels), TileSprite
- [ ] **M** **Anchors for UI scenes:** each object anchors to a canvas edge or center (top-right, bottom-center, ...) with an offset, so a HUD survives different canvas sizes and FIT scaling. The editor previews at a few canvas sizes; the loader snippet applies the anchors.
- [ ] **S** Button-style objects are just Image/NineSlice plus Text in a Container with a name; no behaviour. The AI wires the clicks.
- [ ] **S** Hierarchy group by depth
- [ ] **S** Align/distribute for multi-selection
- [ ] **S** Show the Phaser key in hierarchy and inspector

### Phase 5 — Prefab-lite
- [ ] **M** Object definition (`scenecaster/objects/*.object.json`) plus instances that reference it
- [ ] **M** Per-instance overrides shown as "overridden" in the inspector
- [ ] **S** Prefab library panel

### Phase 6 — Dev loop and optional extras
> No live mode. Your browser, running the game's own dev server, is the live view.
- [ ] **S** **Run dev server** keeps working (existing: script detection, console, stop, process-tree kill) and gains an **Open in browser** link, with `?scene=<key>` for the selected scene. Neither needs anything installed in the game.
- [ ] **S** **Old bridge cleanup:** if a project has `phaser-forge-bridge.js` (e.g. `forge-editor-test`), say so and list the import and `installForgeBridge` lines to remove. The editor does not edit code; it may offer to delete the bridge file.
- [ ] **M** *Optional:* `scenecaster-runtime.js` (about 150 lines): `loadScene(scene, json)` as a real file, only if the Phase 3 snippet proves too weak. Needed first by the Phaser 3 project, if at all.
- [ ] **M** *Optional:* behaviours with inspector properties from `static properties` (Tulio's schema)
- [ ] **S** *Optional:* Arcade body flags on an instance
- [ ] **L** *Nice to have:* local MCP server so an AI (e.g. Claude Code) can work with the open editor.
  - Off by default; localhost only, with a token; confined to the project folder by the Phase 0 path checks.
  - Read: open project, current scene, selection, drift report, canvas screenshot.
  - Navigate: open scene, select object, reload.
  - Write: edit an object through the editor's undo history, so the editor stays the single writer and unsaved changes are never clobbered.
  - Build only if file watching plus the Phase 3 preview and context buttons prove too clumsy in real AI sessions.

### Phase 7 — Release
- [ ] **M** Vitest (store/history/migration/validation/asset rename); Playwright E2E on an ephemeral sample project; lint; CI
- [ ] **M** Windows/macOS/Linux installers, changelog, example project
- [ ] **S** Rename remaining "Phaser Forge" references to Scenecaster (docs, `package.json`, window title, app id); mark old docs superseded

### Validation — tested against

Before calling Phase 3 done, run the whole loop (open, see scenes and settings, adopt with an AI, import an asset, build a scene, AI writes the code that uses it, edit again, drift check clean) on at least these. Pilot on `tiny-realms` or `lords-of-kastrallia` first:

| Project | Why |
|---|---|
| `forge-editor-test` | Has an old bridge; bridge cleanup test |
| `lords-of-kastrallia` | TypeScript, `CLAUDE.md` architecture rules, adapter layer, 2 scenes |
| `keep-and-conquer` | 4 scenes, overlay UI |
| `ember-keep` | Flat `public/` with 742 assets; folder detection and performance |
| `mini-world` | Root-level `assets/`, JS |
| `dungeon-strategy` | No `package.json` at the top; root discovery |
| `quick-civ-roguelite` | Phaser 3.90 |

Not a target: `Kastro-Via` (Phaser Editor 2D owns its scenes).

### Explicitly out of scope
Animation editor, visual physics editor, particle editor, tile/hex map painting (the target games generate their maps in code), live mode (embedded game viewer, runtime inspection and the bridge; the browser reloads on file changes instead), Play/Pause/Step mode, embedded Monaco, GML helpers, signals, own game loop, editing the user's source code, hosted web version, multi-engine export.

## Risks and open decisions

- **Raw JSON vs snippet vs generated code vs runtime file.** Phase 3 ships the snippet (cheapest consistent option) and defers the rest. Let two or three real AI sessions on target projects show whether it is enough.
- **Architecture rules in target projects.** Where `CLAUDE.md` forbids Phaser in the core, scene reading must live in the adapter layer. The `scenecaster/README.md` pointer should say so rather than assume.
- **Two writers.** An AI editing a scene file while the editor has unsaved edits is the main data-loss risk. The prompt-on-conflict rule and `.bak` are not optional.
- **Names vs ids.** AI-written code will reference objects by name, so names must be unique and renames should be visible in diffs. Decide whether renames are blocked, warned or allowed.
- **Rename can break code silently.** The editor reports code references but cannot fix them. An AI can; consider emitting a ready-to-paste "rename report".
- **Unsaved changes are invisible to file watching.** If the AI edits a layout while the editor holds unsaved edits to it, one side loses. The rule is to prompt (keep mine / take theirs / save mine as a copy). Decide whether to shrink the window with a short debounced autosave of scene files, which would make the editor's state reach disk within about a second but removes the explicit "unsaved" state; undo history would be the safety net.
- **Drift after adoption.** Later AI sessions can change code and leave `scenecaster/` stale (a new scene class, an asset loaded directly). The drift check and the `CLAUDE.md` pointer reduce this; they cannot prevent it. Decide whether the check should block `Run` or only warn.
- **Lossy extraction.** Moving placements out of code only works for literal numbers. Positions computed from other values stay in code, so some scenes will be partly editable. `MIGRATE.md` must say so and the AI must report what it left behind.
- **Adoption makes the game depend on `scenecaster/`.** Metadata is bundled as JSON imports, so removing `scenecaster/` breaks an adopted game. Provide an "un-adopt" path (the AI inlines the data back) or accept it as one-way; decide before the pilot.
- **Competing asset manifests.** Target projects have their own loaders and import tools (e.g. `npm run sprites`). After adoption `scenecaster/assets.json` is the list `preload()` reads, so a tool that writes assets must update it (or the drift check flags it).
- **Phaser 3 vs 4.** Tulio targets Phaser 3, and one target project does too. The editor's design mode runs its own Phaser 4, which is fine; verify the loader snippet on 3.90.
- **The reload loop is a full page reload.** Vite cannot hot-swap a Phaser scene, so each save restarts the game. `?scene=<key>` helps for UI scenes; scenes deep in a level may still be slow to reach. Revisit after the pilot.
- **Disabled live-mode code rots.** Decided: disable behind a flag, don't delete. Disabled code drifts out of date as the scene model and protocol change, and it is still typechecked and built. Keep it isolated (own folder, no imports from design-mode code), exclude it from tests, and revisit deleting it after the pilot if it hasn't been re-enabled. Projects that already installed the bridge (`forge-editor-test`) keep working; it only talks to an editor that no longer listens.
