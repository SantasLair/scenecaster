# Implementation Plan — Phase 0 (Foundation)

Source: [ROADMAP.md](ROADMAP.md) Phase 0, [ARCHITECTURE-PLAN.md](ARCHITECTURE-PLAN.md) items 1, 2, 3, 6, 10a.
Why first: Phase 0 enforces principle 5 ("write only under `scenecaster/` and the assets folder") and fixes a clean install. Everything in Phases 1+ builds on the path guard and the typed protocol.

## Work streams

| ID | Task | Files | Size | Agent / model |
|---|---|---|---|---|
| A1 | Script-name allowlist for `devserver:start` (name must be a key in the project's `package.json` scripts; drop `shell: true` injection path) | `src/main/index.ts` | S | `general-purpose`, sonnet |
| A2 | Path guard in main: remember folder chosen via `dialog:openFolder`; every IPC taking a path/folder resolves and rejects anything outside it (symlink-safe via `realpath`). Writes limited to `scenecaster/`-era targets: scene file, config, bridge files. Keep legacy file names for now. | `src/main/index.ts`, `src/preload/index.ts` | M | `general-purpose`, **opus** (security-sensitive) |
| A3 | Fix `npm install` ERESOLVE (pin vite 7, regenerate lockfile, verify `npm ci` + build) | `package.json`, `package-lock.json` | S | same agent as A1/A2 stream is not used; separate `general-purpose`, haiku-class task → sonnet |
| B1 | `ev.source` check on `message` events in the editor; target-origin for outgoing posts | `src/renderer/src/App.tsx` | S | `general-purpose`, sonnet |
| B2 | Store selectors: replace bare `useEditorStore()` with selectors | `src/renderer/src/App.tsx`, components, `store.ts` | S | same as B1 |
| C1 | Typed `protocol.ts` (discriminated unions, shared by editor, `phaser-main.ts`, bridge `.d.ts`) + single property-descriptor table replacing the six duplicated property lists | `src/shared/protocol.ts` (new), `phaser-main.ts`, `App.tsx`, `store.ts`, `Inspector` code | M | `Plan` (opus) for design, then `general-purpose` opus to implement |

## Waves (file-conflict driven)

- **Wave 1 (parallel):** Stream A (main/preload/package files) and Stream B (renderer). File sets are disjoint. A3 touches only package files, so it runs with A.
- **Wave 2:** C1 after B lands (both edit `App.tsx`).
- **Wave 3:** `code-review` skill (high) over the combined diff, then `security-review` skill on stream A. Fix findings.
- Verification each wave: `npx tsc --noEmit`, `npm run build`, and a manual smoke list below. Agents do not commit; the main session reviews diffs and commits per stream on branch `feature/phase0-foundation`.

## Acceptance

- A1: `devserver:start` with script `dev & calc` returns `{ok:false}`; valid script still runs.
- A2: calling any path IPC with a path outside the opened folder (incl. `..` and symlink escape) is rejected; no folder opened = rejected.
- A3: fresh clone `npm ci && npm run build` succeeds without `--legacy-peer-deps`.
- B1: a `forge` message from any window other than the viewport iframe is ignored.
- B2: dragging an object does not re-render the whole `App` (check with React profiler or render counter).
- C1: adding one property requires editing one table entry; `tsc` flags unhandled message types.
- Smoke: open project, assets list, drag asset in, add primitive, save/reload scene, Run/Stop dev server.

## Risks

- Path guard can break "Open project -> Run" if the stored folder is not set before IPC calls; test ordering.
- `shell: true` is needed for `npm` on Windows; replace with allowlisted name plus `npm.cmd` rather than dropping the shell blindly.
- C1 touches the file Phase 1 will refactor heavily; keep it a mechanical change.
