# Architecture Review — Follow-up Plan

Source: architectural review of the codebase on 2026-10-13 (main process, preload, store, `phaser-main.ts`, `App.tsx`, bridge). Not yet started.

## What to keep
- Process split: main owns fs/spawn, preload exposes a narrow API, renderer is UI only, Phaser runs in an iframe.
- Bridge is a no-op outside the editor, so it is safe to ship in a game.
- `stopDevServer` (Windows process tree) and the settle-once promise in `devserver:start`.
- The `commit`/`committed` undo design in `src/renderer/src/store.ts`.

## Phase 1 — Security (small, do first)

- [ ] **1. Command injection via script name.** `devserver:start` runs `spawn('npm', ['run', script], { shell: true })` with `script` from the renderer (`src/main/index.ts`). A name like `dev & calc` executes. Accept only names present in that project's `package.json` scripts.
- [ ] **2. IPC trusts arbitrary paths.** `fs:fileToDataUrl`, `scene:save`, `project:writeConfig`, `bridge:install` take paths from the renderer. With `webSecurity: false` and `sandbox: false`, one XSS or hostile game page means arbitrary file read/write. Main should remember the folder chosen via `dialog:openFolder` and reject paths outside it.
- [ ] **3. No message origin checks.** `App.tsx` handles any `message` event, and the bridge accepts any `forge: true` message; both send with `'*'`. Check `ev.source === iframeRef.current?.contentWindow` in the editor at minimum.

## Phase 2 — Cheap structural wins

- [ ] **6. Typed protocol + single property table.** Add a shared `protocol.ts` (discriminated unions for editor and `forge` messages) and one property-descriptor table. Today the property list is repeated in `DEFAULTS`, `serialize()`, `applyProps()`, the `OBJECT_SELECTED` mapping and the inspector (six places per new property).
- [ ] **7. Portable scene file.** `forge-scene.json` stores absolute `assetFullPath`; store project-relative paths. Replace `Date.now()` object ids with a counter or `crypto.randomUUID()` (collision risk).
- [ ] **10a. Store selectors.** `useEditorStore()` with no selector re-renders all of `App` on every drag tick.

## Phase 3 — Main refactor (do together)

- [ ] **5. Single owner for scene state.** Today objects live in the iframe's Phaser maps, hierarchy in React state, selected props in zustand, and saving needs a `GET_SCENE_STATE` round trip. Move the scene model (`{id, kind, props}[]`) into the renderer, make Phaser a view of it, and make history a command list. This fixes:
  - Undo covers only property edits on the selected object (add/delete/duplicate/rename not undoable).
  - Undoing a deleted object sends `SET_PROPERTIES` to a missing id.
- [ ] **4. Split `App.tsx` (989 lines).** `devUrl ? … : …` runs through hierarchy, inspector, overlays, shortcuts and save, with ~30 `useState`s. Split into `AuthoringMode` and `LiveMode` with their own hooks (`useDevServer`, `useBridge`, `useAuthoringScene`), sharing toolbar and layout.

## Phase 4 — Product/roadmap decisions

- [ ] **8. Live edits are ephemeral.** Bridge edits have no undo, no persistence, and vanish on reload; the two modes don't converge. Decide on a path (e.g. write live edits back into the scene file or source).
- [ ] **9. Bridge versioning.** `installBridge` copies the file into user projects, so versions drift, and the editor ignores the reported `VERSION`. Either publish it as a small npm package or check the version at handshake and warn.

## Smaller items (opportunistic)
- [ ] `idOf` in `phaser-main.ts` is a linear scan; use a reverse map.
- [ ] Selection overlay is redrawn every frame in `update()`; redraw on change.
- [ ] Live mode polls every 500 ms (`LIVE_REFRESH_MS`); consider push from the bridge.
- [ ] Add tests (store undo/redo, `findEntryScript`), a linter, and CI.

## Bugs found by running the app (2026-10-13)

Tested the production build with Playwright against a sample game (`forge-editor-test`).

- [x] **"+" add-object dropdown never adds anything (fixed).** `HierarchyPanel.tsx`: the document `mousedown` handler closes the dropdown (`setShowAdd(false)`) because the dropdown isn't inside `addBtnRef`. The menu item unmounts before its `click` fires. The right-click context menu works (it is inside `menuRef`). Fix: also check a ref on the dropdown, or use `onMouseDown`/`onPointerDown` on the items.
- [ ] **Fresh `npm install` fails (ERESOLVE).** `electron-vite@5` peers on vite `^5 || ^6 || ^7` but the project pins `vite@^8`. Either pin vite 7 or wait for an electron-vite that supports 8. Installed with `--legacy-peer-deps` for testing.
- [ ] `bridge:install` locates its source via `app.getAppPath()/src/bridge`, so it fails when the app is launched as `electron out/main/index.js` (works with `electron .` and packaged builds). Low priority; consider resolving relative to `__dirname`.

Verified working: build and typecheck; open project; asset browser; drag asset into viewport; save/reload of `forge-scene.json`; run game (dev server URL detection, canvas renders); Install Bridge; bridge connect after wiring; object list (named, text); inspector edits reaching the game; click-select and drag in Edit mode; Stop and app quit both free the dev server port.

## Suggested order
1–3 → 6, 7, 10a → 5 + 4 together → decide 8 and 9.

## Also fixed (2026-10-13)
- [x] Scene vanished after Run then Stop: `SCENE_READY` now reloads `forge-scene.json` whenever a project is open, and Run auto-saves unsaved scene work first. Long-term fix is still item 5 (scene model in the renderer).
