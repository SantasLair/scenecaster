# Scenecaster Roadmap

> A scene and asset editor that sits **beside** a hand-written (often AI-written) Phaser 4 project and touches it as little as possible.

**Written:** 2026-10-13. **Revised:** 2026-10-19: the PHASEFORM format and the Godot look and feel are merged in (they were a separate proposal, [PLAN-PHASEFORM-GODOT-UI.md](PLAN-PHASEFORM-GODOT-UI.md), which keeps the detail). See also [ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md).

## What changed in this revision

1. **The scene format becomes [PHASEFORM](https://github.com/SantasLair/phaseform)**, an open format for Phaser 4 scenes with a published reference loader (`phaseform-loader` on npm). It replaces the v1 flat, engine-neutral format. This reverses two earlier decisions: *flat only* (PHASEFORM is a tree with `container`) and *engine-neutral* (it targets Phaser 4).
2. **The UI is restyled to look and feel like Godot's editor**, done in steps that do not depend on the format change.
3. **Phases are reordered.** The format adoption comes before the asset pipeline and the hand-off work, because both of those now build on PHASEFORM files (`phaseform.project.json`, its asset manifest, `phaseform-cli`).
4. Items the PHASEFORM toolkit already provides (loader snippet, JSON Schemas, `check.mjs`) are replaced by "use the toolkit".

## Status at a glance (2026-10-19)

| Phase | State |
|---|---|
| 0 Foundation | Done |
| 1 Trustworthy scene file (on the v1 format) | Mostly done; the open items are re-homed below |
| 1b Quick wins (rename, title bar) | Not started |
| 2 Adopt PHASEFORM | **Started:** loader is a dependency and builds the viewport objects; the model is still flat v1 |
| 3 Godot look and feel | Not started; step 1 (theme) can run in parallel with Phase 2 |
| 4 Asset pipeline | Not started (rebased onto the PHASEFORM manifest) |
| 5 Hand-off to code, adopting projects | Not started (rebased onto the toolkit) |
| 6 Phaser object types | Not started (mostly delivered by Phase 2 plus per-type UI) |
| 7 Prefab-lite | Not started, blocked on a PHASEFORM prefab spec |
| 8 Dev loop and extras | Not started |
| 9 Release | Not started |

Two tracks can run side by side: **format** (Phases 2, 4, 5, 6) and **look** (Phase 3). The Phase 3 theme work touches CSS and components only.

## Use case (the constraint that shapes everything)

1. **Manual scene editing:** the human places and tunes objects visually.
2. **AI-driven code:** an AI agent (Claude Code or similar) writes and changes the game code.
3. **Asset management:** the human uses the editor to add assets to the project.

The editor and the AI never talk to each other. They share **files**: the scene documents, the project file and the assets folder. So the file formats are the product, and PHASEFORM is now the format.

### Target projects

The roadmap is checked against a set of local Phaser prototype games (bannerwake, ember-keep, forge-editor-test, hexTiles-fantasy, keep-and-conquer, lords-of-kastrallia, mini-world, quick-civ-roguelite, tiny-realms, turnstead, plus Auto-Shooter-Survivor, Kastro-Via, dungeon-strategy). Survey findings (file listing and grep, not a code read):

- Mostly Vite + Phaser 4 (one Phaser 3.90, which PHASEFORM does not support), JS or TS, with `CLAUDE.md` architecture rules in several. Some forbid Phaser in the core, so scene-reading code belongs in the adapter layer.
- The games are largely procedural (hex maps, generated terrain). Hand-placed objects are rare today, so **visual scenes are assumed to be added**: title screens, HUDs, menus and battle staging.
- Assets live in `public/assets`, `assets` at the root, or a flat `public/` (up to 742 files), and several have their own import tools.
- Several projects have 2 to 5 scene classes, some running as overlays (UI over map).
- `dungeon-strategy` has no `package.json` at its top level. `Kastro-Via` already uses Phaser Editor 2D and is out of scope except possibly for asset import.

## Principles

1. **Zero footprint until you adopt.** Opening a project writes nothing. Saving a scene, importing an asset or changing a setting creates the project's PHASEFORM files and the editor's own folder. No changes to `package.json`, `src/`, `index.html` or the entry file.
2. **Anything that touches game code is opt-in and removable.** There is no live bridge: the loop is edit, save, and the game's own dev server reloads the browser. Adopting a project is the one deliberate exception: an AI, started by you, changes the game to load its scenes through `phaseform-loader`. Unadopted projects stay untouched.
3. **Files are the API.** Scene and project files are PHASEFORM: plain JSON, stable key order, readable names, small git diffs, validated by the PHASEFORM schemas. Names matter more than ids for anything the AI has to reference.
4. **Safe with a second writer.** The AI and git change files while the editor is open. Watch, reload, never clobber. Known limit: file watching cannot see unsaved editor changes, so the editor prompts when a file changes under unsaved edits.
5. **Never edit the user's code.** The editor writes only inside its folders (project file, scenes, assets, editor sidecar). When a rename or move would break code references, it reports them. It does not rewrite code.
6. **No data loss, boring reload.**
7. **Preserve what you do not understand.** PHASEFORM tools must keep unknown types and fields. The editor round-trips them.
8. **The spec comes first.** New file-format behaviour goes into the PHASEFORM spec (its own repo) before the editor relies on it. Expect to change both repos together while the spec is draft v0.x.
9. **One roadmap, small surface.** Anything needing its own panel family (physics, particles, tilemaps) is out.

## Scene format: PHASEFORM

Detail and field mapping are in [PLAN-PHASEFORM-GODOT-UI.md](PLAN-PHASEFORM-GODOT-UI.md). Summary:

| | Scenecaster v1 (today) | PHASEFORM (target) |
|---|---|---|
| Structure | Flat list | Tree with `container` |
| Object kinds | `sprite`, `primitive` | image, sprite, text, bitmapText, tileSprite, 7 shapes, container |
| Rotation/scale/origin | `rotation`, `scaleX/Y`, `originX/Y` | `rotation`, `scale` and `origin` as vec2; no origin on containers |
| Assets | path in `asset` | `key` into the project's asset manifest |
| `anchor` | core field | in the spec since the 0.2 loader, root objects only |
| `interactive` | core field | not in the spec |
| Files | `scenecaster/scenes/*.scene.json`, `project.json` | `*.phaseform.json`, `phaseform.project.json` |
| Rendering | the editor's own objects | `phaseform-loader` |

Decisions assumed in this revision (change them here if wrong; the PHASEFORM plan lists them as open questions):

- **PHASEFORM replaces v1.** Do not maintain both. A one-time `.scene.json` to `.phaseform.json` migration is provided.
- **Unique, code-identifier names stay**, using PHASEFORM's `name` field, enforced by a Scenecaster validation rule.
- **`anchor` is now in the spec** (loader 0.2.0, root objects only; `x` and `y` stay the position at the design size). **`interactive` stays editor-side for now**, in the editor sidecar (the PHASEFORM project doc calls for a separate sidecar spec), and is proposed upstream as a spec change.
- **Scene file location follows the PHASEFORM convention** (`scenes/*.phaseform.json` next to `phaseform.project.json`); Scenecaster keeps only editor-only data in its own `scenecaster/` folder.
- **Godot reference theme: Modern** (the 4.8 default); check how it looks before committing.

## Phases

Effort: **S** (under a day) · **M** (a few days) · **L** (a week or more).

### Phase 0: Foundation (done)
- [x] Script-name allowlist for `devserver:start`; path guard in main (writes confined to the opened project); `ev.source` check; npm install fix (vite 7); typed `protocol.ts` and single property table; store selectors.

### Phase 1: A scene file you and an AI can both trust (v1; mostly done)
Built on the v1 format. Anything format-specific is redone in Phase 2; the editor machinery stays.
- [x] Scene model in the renderer; command-based undo history; scenes in `scenecaster/scenes/`; AI-friendly format; project root discovery; write nothing on open; engine profile; watch scene files and reload; dirty tracking, atomic write and `.bak`; validate on load; live mode disabled behind one flag; `App.tsx` split into hooks; dockview panel layout; context-aware UI (`uiState.ts`); scene list and picker (open any scene with a layout).
- [ ] **S** Scene `key` and `overlay`: saved and validated; no overlay backdrop in the viewport yet.
- [ ] **M** `project.json` (partial: canvas size, engine and dev script only). *Becomes `phaseform.project.json` in Phase 2.*
- [~] **M** Project overview panel (`ProjectPanel.tsx`): shows the project file's name, entry scene and counts, and what the source scan detects (game config and canvas size, scene classes, asset loads, with computed ones counted as unreadable), marked "detected, not saved". A new project's setup dialog now suggests its first scene (a drop-down of the scene keys found in the code, the game config's first scene preselected) and the canvas size from the game config (`suggestFirstScene`). Still to do: editing a setting and writing it back.
- [x] **M** Scene list joined to the scene registry (`shared/sceneRegistry.ts`, shown in the Project panel): states *layout + code*, *code only*, *layout only*, a flag for classes missing from the game config, and "Create layout" on a code-only scene with a valid key.
- [ ] **S** *Optional:* scene flow view drawn from the registry.
- [~] **S** Multi-select, copy/paste, per-scene camera persistence, recent projects. *(Arrow-key nudge is done: the arrows move the selected object 1 px, Shift 10 px, in its parent's coordinates; locked objects stay put; held keys and quick presses are one undo step; the Objects and FileSystem trees keep the arrows for their own navigation.)*
- [ ] **S** Folder-name constant is in `src/shared/layout.ts`; the generated docs (`MIGRATE.md` and others) that read it are not started.

### Phase 1b: Quick wins (can go any time)
- [x] **S** **Remove "Phaser Forge" naming** *(done for the toolbar label, `productName`, `appId`, package name and viewport title; the bridge files and the README credit line stay)*: the `⚡ Phaser Forge` toolbar label (`App.tsx`), `productName`, `appId` and package name in `package.json`, the viewport page title, and docs. Leave the disabled live-mode bridge files (`phaser-forge-bridge.*`) alone, and keep the README's credit line to the upstream project. Folded into Phase 9 only as a final sweep.
- [x] **S** Set up `THIRD_PARTY.md` (Godot icons CC BY 4.0, fonts OFL).

### Phase 2: Adopt PHASEFORM (format track, first)
Phase A of the PHASEFORM plan. The riskiest piece is the viewport; the rest follows from it.
- [x] **S** Add `phaseform-loader` as a dependency (published to npm; now `^0.2.0`, which adds anchors, with the vendored scene schema updated to match).
- [x] **M** Viewport builds the whole scene document through the loader (containers, text, shapes, tileSprites, filters; a failing object becomes a placeholder), with gizmos that work through parent transforms.
- [x] **M** **Tree model:** the scene is a tree; undo is snapshot-based; the Objects panel supports nesting, drag-reparent, rename, duplicate, lock and visibility.
- [x] **M** **Inspector** driven by a per-type field table (`inspectorFields.ts`) with raw-JSON editing for anything it does not know. *(Table-driven rather than generated from the JSON schema.)*
- [x] **S** Validate on load with the PHASEFORM schemas (vendored) plus the cross-checks the schemas cannot express; results in the Problems panel; unknown types and fields are preserved and files keep their line endings.
- [~] **M** Read and write `phaseform.project.json`: scene list and asset manifest are read, a dropped image is added to the manifest, new scenes are registered. The model can now edit, rename (rewriting references in the open scene and the project) and remove manifest entries (`shared/phaseform/assets.ts`, `sceneModel.ts`). A "Project Assets" panel (`ManifestPanel.tsx`) edits entries: key, image/spritesheet type, file paths, frame size, margin, spacing, audio urls and raw JSON for unknown types, all undoable. The panel and the Inspector's Frame field show the sheet with its frame grid (`SheetPreview.tsx`, layout maths in `shared/phaseform/sheet.ts`); clicking a frame in the Inspector sets the object's `frame`. An "Animations" panel (`AnimationsPanel.tsx`, `shared/phaseform/animations.ts`) creates, edits, renames and removes animations (frames picked from the sheet grid, frame rate, repeat, yoyo, live preview), and a sprite's Inspector has an Animation picker. Renaming an asset also rewrites the other scene files on the next save (pending renames are part of the undo snapshot). Not yet: adding atlas, font or audio entries by hand in the panel.
- [x] **M** ~~v1 migration~~ Dropped: no backward compatibility with the flat format was wanted. Port round-trip checks from the PHASEFORM conformance suite is still open.
- [~] **S** Objects have a unique `id` (enforced) and an optional `name`; the old identifier-name rule is gone with the flat format.
- [~] **S** `anchor` is in the spec and the Inspector edits it (root objects only, warning for container children). Still to do: propose `interactive` upstream and store it in the editor sidecar meanwhile.
- [x] **S** `SCENE_FORMAT.md` is now a short pointer to the PHASEFORM spec plus Scenecaster's rules.

### Phase 3: Godot look and feel (look track)
Step 1 does not depend on Phase 2 and can go first for a quick visible win. Godot's code is MIT, so porting algorithms is fine; its icons are CC BY 4.0 (attribute in `THIRD_PARTY.md`). Do not use Godot's logo or name in the UI.
- [~] **M** **Theme foundation.** *(Done: `theme/godotTheme.ts` derives the surfaces, fonts and accent from base, accent and contrast and maps them onto the Tailwind palettes and dockview; Inter and JetBrains Mono are bundled; presets Default, Black, Gray, Breeze Dark and Light exist in code. The theme settings dialog (toolbar 🎨: preset, base colour, accent colour, contrast; applied live and remembered in localStorage) is done. Still to do: radius and spacing tokens applied to components, the viewport iframe colours.)* Port Godot's theme derivation (`editor/themes/editor_theme_manager.cpp`): base colour, accent colour and contrast generate every surface shade as CSS variables, replacing the `@theme` tokens in `index.css`. Add Inter and JetBrains Mono (OFL). Use Godot's compact density and radius tokens. Check the Modern look first.
- [~] **M** **Icons.** Done: 20 of Godot's SVGs (tag 4.4-stable) in `src/renderer/src/icons/`, recoloured to `currentColor` by the `Icon` component, used in the toolbar and for the Objects panel's lock and visibility buttons. Object-type icons and tree arrows are done. Still to do: the FileSystem panel, panel tabs and the remaining glyphs (▾ ▸ and the like), and removing the unused `lucide-react` dependency.
- [~] **L** **Components**, in this order: Objects panel (tree rows, disclosure arrows, inline visibility and lock), Inspector (two-column rows, collapsible sections, reset arrows, drag-to-scrub numbers), dockview tabs and splitters, menus and toolbars. Do the tree rows and inspector after Phase 2 steps 3 and 4 land, so they are restyled once. *(Objects panel done: Godot's node icons per object type, tree arrows, 24px rows, the Add menu as a themed popup with icons. Inspector done: collapsible sections (remembered across selections), two-column rows, Godot's reset arrow on fields that are set, drag-to-scrub number fields (step per pixel, Shift for a tenth, click to type). Still to do: dockview tabs and splitters, menus and toolbars.)*
- [x] **M** **FileSystem panel** (Godot's FileSystem dock): lazy project tree with folders first, file-type icons, a filter that searches the whole project, F5 and focus refresh, keyboard navigation, a context menu (show in file manager, copy path), double-click opens a scene, images drag into the viewport. Dot-folders and `node_modules`, `dist`, `out`, `release`, `build` and `coverage` are hidden. The Assets tab stays until Phase 4 decides what to keep.
- [ ] **M** **Viewport chrome:** tool toolbar, zoom control, grid and snap menu, Godot's selection and gizmo colours on the overlay.
- [ ] **M** **Layout and polish:** default arrangement (scene tree left with the Project panel as a tab, inspector right, files bottom-left, output bottom), reset-layout command, light and dark, and every state (hover, focus, disabled, selected-but-inactive).

### Phase 4: Asset pipeline (rebased onto the PHASEFORM manifest)
> The editor is the place assets enter the project; the AI reads the result. Can start once Phase 2's project-file work is in.
- [x] **S** Assets folder auto-detection (`public/assets`, `assets`, `public`) is done (`shared/assetImport.ts`); the Assets tab has a Change… button (and Auto to go back) that stores the folder as `assetsDir` in `scenecaster/editor.json`. The manifest stores both the file path and the URL the game loads, because Vite serves `public/` from the site root.
- [x] **M** Import: the Assets tab has an Import button (system file picker) and takes files dropped from the OS; copies go into the assets folder, the selected folder or a typed subfolder, never overwrite (`name-2.png`), and images and audio are registered in the manifest as one undo step (`main` `assets:import`). A data file imported with an image of the same name (`hero.png` + `hero.json`, `font.png` + `font.fnt`) becomes an atlas or bitmapFont entry, and audio files of the same name (`boom.mp3` + `boom.ogg`) share one audio entry (`planManifestEntries`); a data file alone is only copied. The Assets tab lists images, audio and data files; only images can be dragged into the viewport.
- [ ] **M** Asset kinds follow PHASEFORM's manifest types: image, spritesheet (frame size, margin, spacing; frames pickable), atlas, bitmapFont, audio (with preview).
- [ ] **M** **Manifest in `phaseform.project.json`**: key, type, url, frame config. Keys are auto-suggested from the file name and editable. (This replaces the old `scenecaster/assets.json`.)
- [ ] **S** Rename or move an asset: update the manifest and every scene file, and **list code references** (grep) for the human or AI to fix. It does not edit code.
- [x] **S** Delete asset with a usage check (done: the Remove confirmation lists uses in the open scene, the project and every other scene file; the Project Assets panel has a "Check assets" report of unused entries and entries whose files are missing); unused and missing asset report; optional size warnings.
- [x] **S** Watch the assets folder: the Assets tab and an open "Check assets" report refresh when files are added, removed or renamed outside the editor (`fs.watch` on the assets folder, debounced; the FileSystem panel still refreshes on F5 or focus).

### Phase 5: Hand-off to code and adopting existing projects (rebased onto the toolkit)
> Make it trivial for an AI to use the project file and scenes, and to convert an existing game. The toolkit already provides a loader, schemas, a CLI and a Vite plugin.

**Adopting an existing project** (AI-run, one project at a time, started by you):
- [~] **M** `MIGRATE.md`, written by the editor to `scenecaster/MIGRATE.md` (`shared/migrate.ts`): scenes with their state and class, literal loads missing from the manifest, computed loads to check by hand, the rules and steps below. Still to do: revise it from the pilot.
- [x] **S** "Adopt this project" button (Project panel): writes `MIGRATE.md`, shows the one-line `CLAUDE.md` pointer with a copy button, records `adopted: true` in `editor.json` once the drift check is clean. Nothing in the game is changed by the editor itself.
- [~] **M** **Drift check** (`shared/drift.ts`, Drift section of the Project panel, "Copy for AI" report): a scene class with no registry entry; a scene file with no scene class; an asset loaded in code that is not in the manifest; a manifest file that is missing. Runs on open and Rescan and when the manifest changes. Still to do: re-run when game source files change on disk.
- [ ] **M** **Validation without the GUI:** use `phaseform-cli validate`. Needs the CLI published with its schemas bundled (today it reads them from the repo root). The editor and the CLI share one validation source.
- [ ] **S** The `CLAUDE.md` pointer says to keep the PHASEFORM files in sync when changing scenes, assets or settings, to run the validator afterwards, and to put scene-reading code in the adapter layer where the project requires it.
- [ ] **S** Pilot on one small project (`tiny-realms` or `lords-of-kastrallia`); revise `MIGRATE.md` from what the AI got wrong.

**Hand-off to code:**
- [ ] **S** `README` for the project files, written by the editor: formats, rules ("edit scenes via the editor or follow the PHASEFORM schema"), a pointer to the loader. A one-line `CLAUDE.md`/`AGENTS.md` pointer is offered, never inserted automatically. *(The old "loader snippet" and "JSON Schema" items are dropped: the published loader and schemas replace them.)*
- [ ] **S** **Dev shortcut convention** in `MIGRATE.md`: the game reads `?scene=<key>` (dev only) and starts there, because Vite does a full page reload when a scene file changes.
- [ ] **M** "Copy as Phaser code" for one scene or selection.
- [ ] **S** **Scene preview image:** on save, write `previews/<Scene>.png` (git-ignored) so an AI can look at a layout without running the game.
- [ ] **S** **Copy context for AI** (selected object's name, scene, file, values), and "Copy for AI" on the drift and validation reports.
- [ ] **S** Decision point after two or three adopted projects: does the loader plus `MIGRATE.md` suffice? How does the reload loop feel?

### Phase 6: Phaser object types and editing (PHASEFORM Phase B)
Most types arrive with Phase 2 (the loader builds them); this phase adds editor UI for each, ordered by what the target projects need.
- [ ] **M** **Containers:** nesting and local transforms in the gizmos.
- [ ] **M** Text and bitmapText; shapes (7); tileSprite; nine-slice if the spec adds it.
- [ ] **S** **Button** object (image or panel plus optional label, `interactive` on, a name that is the code contract). No behaviour; the AI wires the clicks.
- [~] **M** **Anchors for UI scenes.** Done: the Inspector picker and the validation warning. Still to do: preview at a few canvas sizes (call the loader's `layout(width, height)` for a chosen size; the viewport draws the design size today).
- [ ] **M** Animations (defined in the project file).
- [ ] **M** Filters and masks with live preview.
- [~] **S** **Scripts in the Inspector.** *(Step 1 done: a "Scripts" section on every object with an ordered list, move up/down buttons (not drag), remove, show in file manager, a red "(missing)" flag and an "Add script…" picker fed by the new `fs:listScripts` call (.js, .mjs, .ts, .mts under the project, hidden folders skipped). A malformed `scripts` value stays in Advanced. Still to do: steps 2 to 5, and drag-reorder if the buttons feel clumsy.)* Today `scripts`, `params` and `placeholder` only show as raw JSON under Advanced, and the viewport does not run scripts, so a code-drawn object is invisible. Build in this order:
  1. **Scripts section** (any object type): an ordered, drag-reorderable list of script paths; "Add script" picks from the project's `.js`/`.ts` files (like the texture picker); a missing path shows red "(missing)"; open-in-editor button; no new format fields.
  2. **Params table:** key/value rows with the type inferred (number, string, bool, `#rrggbb` colour) using the existing field controls, and a raw-JSON toggle for nested values. Replaces the `params` box under Advanced.
  3. **Placeholder section:** on/off toggle, kind, width and height, fill and stroke colour (editor-only data; the loader ignores it). Viewport draws it as a dashed marker with a small script badge, so scripted objects stay visible. A hint appears on scripted objects that have none.
  4. **Tree cues:** a script icon on scripted rows in the Objects panel and an "Open script" action (Godot's attached-script cue).
  5. **Validation:** wrong-typed params get a red border; keep the spec's `params` must-be-an-object rule; the Advanced hint says `scripts` and `params` now have their own controls.
- [ ] **M** **Script-declared param schemas** (see Phase 8, *behaviours*): the Inspector builds typed controls from a schema the script exports.
- [ ] **S** Align/distribute for multi-selection; show the Phaser key in the Objects panel and inspector.

### Phase 7: Prefab-lite (blocked)
PHASEFORM leaves prefabs and templates out of v0.1 ("may come later as a separate spec"). Do not invent a Scenecaster format.
- [ ] **S** Propose a prefab design upstream first.
- [ ] **M** Then: object definitions plus instances, per-instance overrides shown as "overridden", a prefab library panel.

### Phase 8: Dev loop and optional extras
> No live mode. Your browser, running the game's own dev server, is the live view.
- [ ] **S** **Run dev server** (existing) gains an **Open in browser** link, with `?scene=<key>`.
- [ ] **S** **Old bridge cleanup:** if a project has `phaser-forge-bridge.js`, say so and list the lines to remove. The editor does not edit code.
- [ ] **M** *Optional:* behaviours with inspector properties. This is the script-declared param schema in Phase 6: a script exports e.g. `params = { seconds: { type: 'number', default: 5, min: 0.1 }, color: { type: 'color', default: '#ffcc33' } }`, and the Inspector shows scrub/colour/checkbox/select controls with defaults and reset arrows, and flags `params` keys the schema does not know (typos). The schema lives in the script, not in the PHASEFORM file, so the format is unchanged; the editor only reads the file and never edits code. Needs the convention agreed with the PHASEFORM side first (propose upstream, as for `interactive`).
- [ ] **L** *Nice to have:* local MCP server so an AI can work with the open editor. Off by default, localhost only with a token, confined to the project folder. Build only if file watching plus the preview and context buttons prove too clumsy.

### Phase 9: Release
- [ ] **M** Vitest (store, history, migration, validation, asset rename); Playwright E2E on an ephemeral sample project; lint; CI.
- [ ] **M** Windows/macOS/Linux installers, changelog, example project.
- [ ] **S** Final sweep for any remaining "Phaser Forge" references (docs, installer strings); mark old docs superseded; `THIRD_PARTY.md` complete.

### Validation: tested against

Before calling Phase 5 done, run the whole loop (open, see scenes and settings, adopt with an AI, import an asset, build a scene, AI writes the code that uses it, edit again, drift check clean) on at least these. Pilot on `tiny-realms` or `lords-of-kastrallia` first:

| Project | Why |
|---|---|
| `forge-editor-test` | Has an old bridge; bridge cleanup test |
| `lords-of-kastrallia` | TypeScript, `CLAUDE.md` architecture rules, adapter layer, 2 scenes |
| `keep-and-conquer` | 4 scenes, overlay UI |
| `ember-keep` | Flat `public/` with 742 assets; folder detection and performance |
| `mini-world` | Root-level `assets/`, JS |
| `dungeon-strategy` | No `package.json` at the top; root discovery |
| `quick-civ-roguelite` | Phaser 3.90: **not supported by PHASEFORM**; drop it from the list or keep it as a "fails gracefully" test |

Not a target: `Kastro-Via` (Phaser Editor 2D owns its scenes).

### Explicitly out of scope
Visual physics editor, particle editor, tile/hex map painting (the target games generate their maps in code), live mode (embedded game viewer, runtime inspection and the bridge), Play/Pause/Step mode, embedded Monaco, own game loop, editing the user's source code, hosted web version, multi-engine export (PHASEFORM is Phaser 4).

## Risks and open decisions

- **Tree versus flat.** Gizmo math, undo, anchors and drag-reorder assume a flat list. Containers need parent transforms while dragging, and anchors are ambiguous for nested objects (the spec limits them to root objects).
- **Spec instability.** PHASEFORM is draft v0.1: fields may still change. Expect to change both repos together; new behaviour goes into the spec first. Pin the loader version and re-run the conformance cases on each bump.
- **Published packages are partial.** Only `phaseform-loader` is on npm. The CLI needs the schemas bundled and the Vite plugin needs a real dependency on the CLI before either can be published; Phases 2 (inspector, validation) and 5 depend on that.
- **Phaser 3 is out.** One target project is on Phaser 3.90, which PHASEFORM does not support.
- **Two writers.** An AI editing a scene file while the editor has unsaved edits is the main data-loss risk. The prompt-on-conflict rule and `.bak` are not optional. Decide whether a short debounced autosave would shrink the window.
- **Names vs ids.** AI-written code references objects by name, so names must be unique across the whole tree (not only per parent). Decide whether renames are blocked, warned or allowed, and whether to emit a ready-to-paste rename report.
- **Drift after adoption.** Later AI sessions can change code and leave the PHASEFORM files stale. The drift check and the `CLAUDE.md` pointer reduce this; decide whether the check blocks `Run` or only warns.
- **Lossy extraction.** Moving placements out of code only works for literal numbers. Computed positions stay in code, so some scenes will be partly editable. `MIGRATE.md` must say so.
- **Adoption makes the game depend on PHASEFORM files and `phaseform-loader`.** Provide an "un-adopt" path (the AI inlines the data back) or accept it as one-way; decide before the pilot.
- **Competing asset manifests.** Target projects have their own loaders and import tools. After adoption `phaseform.project.json` is the list, so a tool that writes assets must update it (or the drift check flags it).
- **The reload loop is a full page reload.** Vite cannot hot-swap a Phaser scene; `?scene=<key>` helps for UI scenes. Revisit after the pilot.
- **Disabled live-mode code rots.** Keep it isolated (own folder, no imports from design-mode code), exclude it from tests, and revisit deleting it after the pilot.
- **Third-party material.** Godot icons are CC BY 4.0: keep attribution current. Check the licence of anything else borrowed before shipping.
