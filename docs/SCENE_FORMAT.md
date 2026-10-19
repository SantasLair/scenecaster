# Scene format

Scenecaster edits **PHASEFORM** files: https://github.com/SantasLair/phaseform (draft v0.1). The specification, the JSON Schemas and the reference loader live there; this page only lists what Scenecaster adds.

## Files

| File | Written by | Purpose |
|---|---|---|
| `phaseform.project.json` (project root) | Scenecaster, on the first save | Project name, entry scene, the scene list and the asset manifest |
| `scenes/<key>.phaseform.json` | Scenecaster | One scene: size, background, and a tree of objects |
| `scenecaster/editor.json` | Scenecaster | Editor-only settings (the chosen dev script). Never read by the game |

Opening a project writes nothing. A folder without `phaseform.project.json` gets one, plus `scenes/main.phaseform.json`, when you save.

## What the editor does with a document

- Keeps documents as plain JSON, in their own key order, two-space indented: saving an untouched document reproduces it, and an edit changes only the lines it touches.
- Preserves every type, field and extension it does not understand, and offers unknown object fields as raw JSON in the Inspector.
- Validates on load with the PHASEFORM schemas (copied into `src/shared/phaseform/schema/`) plus the rules the schemas cannot express (unique ids, filter references), and checks texture and animation references against the manifest. Problems appear in the Problems panel; only a file that is not a PHASEFORM document at all blocks editing.
- Builds the viewport with `phaseform-loader`, so what you see is what the game's loader builds. Scripts are not run.

## Not in PHASEFORM, not in the editor (yet)

`anchor`, `interactive`, per-object lock and the editor camera are not part of the format. Locking is session-only. See [ROADMAP.md](ROADMAP.md) for how editor-only data is planned.
