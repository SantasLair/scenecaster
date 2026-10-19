# Plan: adopt PHASEFORM and Godot's look and feel

**Written:** 2026-10-19. Status: **merged into [ROADMAP.md](ROADMAP.md) on 2026-10-19**, which now holds the phases and status. This file keeps the field mapping, rationale and detail. Phase A steps 1 and 2 are partly done (loader dependency; viewport builds objects through it). Open questions are at the end.

Two changes to Scenecaster. PHASEFORM changes the data model, the Godot look changes the UI. Do the format first so the UI is restyled once, on the final panels.

Sources: PHASEFORM at https://github.com/SantasLair/phaseform (spec, schemas, `phaseform-loader`, `phaseform-cli`). The Godot 4.8 source (theme code in `editor/themes/`, icons in `editor/icons/`, fonts in `thirdparty/fonts/`).

## Background

Scenecaster already resembles Godot's editor: dockview panels, a viewport, an Objects panel, an Inspector, an Asset Browser, Q/W/E/R tools, and a gray and blue palette in `@theme` tokens (`src/renderer/src/index.css`). The look change is mostly a re-skin.

The format change is not. Scenecaster's v1 format and PHASEFORM differ:

| | Scenecaster v1 | PHASEFORM |
|---|---|---|
| Structure | Flat list, no nesting | Tree with `container` |
| Object kinds | `sprite`, `primitive` (rect/circle/triangle) | image, sprite, text, bitmapText, tileSprite, 7 shapes, container |
| Rotation/scale | `rotation`, `scaleX`, `scaleY` | `rotation`, `scale` (vec2) |
| Origin | `originX`, `originY` | `origin` (vec2), not on containers |
| Sprite asset | path in `asset` | `key` into the project's asset manifest |
| `anchor`, `interactive` | core fields | not in the spec |
| Engine data | `phaser: {...}` extension | core fields plus namespaced extensions |
| Files | `scenecaster/scenes/*.scene.json`, `project.json` | `*.phaseform.json`, `phaseform.project.json` |
| Rendering | Editor's own Phaser scene | `phaseform-loader` |

ROADMAP.md currently rejects layers and hierarchy and requires an engine-neutral format. Adopting PHASEFORM reverses both decisions.

## Decisions (proposed)

- PHASEFORM replaces the v1 format. Do not maintain both. Provide a one-time `.scene.json` to `.phaseform.json` migration.
- Unique, code-identifier names stay. They use PHASEFORM's `name` field, enforced by a Scenecaster validation rule.
- `anchor` and `interactive` are not in PHASEFORM. Either keep them in the editor-only sidecar (see PROJECT.md, "Editor-only data") or propose them to the spec. `anchor` changes how `x`/`y` are stored, so hiding it in an extension would need the loader to apply it. Prefer proposing it upstream.
- Scenecaster stops being engine-neutral. Engine data becomes PHASEFORM extensions.
- Keep the rule that the editor writes only inside its own folder and the assets folder.

## Phase A: adopt the format (first)

1. Add `phaseform-loader` and the schemas as dependencies (path link; the packages are unpublished).
2. Replace `src/shared/scene.ts` and the hand-built objects in `phaser-main.ts` so the viewport builds scenes through the loader.
3. Change the model from a flat list to a tree: `sceneModel.ts`, undo history, and the Objects panel (drag-reorder depth becomes drag-reparent).
4. Make the inspector schema-driven from `phaseform.schema.json`, replacing the table in `src/shared/props.ts`.
5. Validate on load and save with the PHASEFORM checks; show results in the Problems panel.
6. Read and write `phaseform.project.json`. The Asset Browser writes manifest entries instead of bare paths.
7. Write the v1 migration and tests; port round-trip checks from PHASEFORM `conformance/`.

## Phase B: Phaser-specific editing the format enables

Order by what the target projects need.

- Containers: nesting and local transforms in the gizmos.
- Text and bitmapText, shapes, tileSprites.
- Animations (defined in the project file).
- Filters and masks with live preview.
- Attaching scripts by path.

## Phase C: Godot look and feel

Step 1 does not depend on Phase A and can go first for a quick visible win.

1. **Theme foundation.** Port Godot's theme derivation (`editor/themes/editor_theme_manager.cpp`): base color, accent color and contrast generate every surface shade as CSS variables. Replace the `@theme` tokens in `index.css`. Add Inter and JetBrains Mono (OFL). Set Godot's compact density and radius tokens. Pick Classic or Modern as the reference; Modern is the current default in 4.8, so check how it looks first.
2. **Icons.** Copy only the used SVGs from `editor/icons/` (1045 available) into `src/renderer/src/icons/`, recolored with `currentColor`, behind an `Icon` component. Replace lucide usages. They are CC BY 4.0, so add a `THIRD_PARTY.md` with attribution.
3. **Components**, in this order: Objects panel (tree rows, disclosure arrows, inline visibility and lock), Inspector (two-column rows, collapsible sections, reset arrows, drag-to-scrub numbers), dockview tabs and splitters, menus and toolbars.
4. **Viewport chrome.** Tool toolbar, zoom control, grid and snap menu, and Godot's selection and gizmo colors on the overlay.
5. **Layout and polish.** Default arrangement (scene tree left, inspector right, files bottom-left, output bottom), reset-layout command, theme settings dialog, light and dark, and every state (hover, focus, disabled, selected-but-inactive).

## Licensing

Godot's code is MIT, so porting algorithms is fine. Icons need CC BY 4.0 attribution. Do not use Godot's logo or name in the UI; keep Scenecaster's branding.

## Risks

- **Tree versus flat.** Gizmo math, undo and anchors assume a flat list. Containers need parent transforms applied while dragging. Anchors become ambiguous for nested objects; probably limit them to top-level objects.
- **Spec instability.** The loader and spec are v0.x. Expect to change both repos together, and per the PHASEFORM roadmap, put any new behavior in the spec first.
- **Adoption workflow.** The documented "game reads scenes from `scenecaster/`" flow must be rewritten to use the loader.

## Open questions

1. Accept dropping the flat, engine-neutral design for PHASEFORM's tree?
2. Where do scene files live: keep `scenecaster/scenes/`, or the PHASEFORM convention?
3. Propose `anchor` and `interactive` to the PHASEFORM spec, or keep them editor-only?
4. Classic or Modern Godot theme as the reference?

## Suggested first step

Phase A steps 1 and 2 (loader-backed viewport) on a branch. It is the riskiest piece and everything else depends on it.
