# Scene format (version 1)

`scenecaster/scenes/<key>.scene.json`. Plain JSON, engine-neutral, flat (no nesting). Any engine can load it; engine-specific data is namespaced.

```json
{
  "version": 1,
  "key": "hud",
  "overlay": true,
  "objects": [
    {"id":"<uuid>","name":"playButton","kind":"sprite","asset":"assets/play.png","x":-20,"y":-20,"rotation":0,"scaleX":1,"scaleY":1,"alpha":1,"visible":true,"depth":1,"anchor":"bottom-right","interactive":true,"phaser":{"originX":1,"originY":1,"flipX":false,"flipY":false,"tint":"#ffffff","scrollFactorX":0,"scrollFactorY":0}}
  ]
}
```

- **Scene:** `key` (matches the file name and the game's scene key), `overlay` (draws over another scene; canvas size comes from the game), `objects` (array; array order is the editor's list order).
- **Object core:** `id` (UUID, stable), `name` (unique, a valid code identifier: it is the contract with code), `kind` (`sprite` with `asset`, a path relative to the project folder; or `primitive` with `shape` `rect|circle|triangle`), `x`, `y`, `rotation` (radians), `scaleX`, `scaleY`, `alpha`, `visible`, `depth` (z-order, higher is in front; defaults to list index when absent), `anchor`, `interactive`.
- **`anchor`:** `null` (absolute from the top-left) or one of `top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right`. With an anchor, `x`/`y` are an offset from that point of the canvas, so a HUD survives different canvas sizes.
- **`interactive`:** the code will attach input to this object (a button, a hotspot).
- **`phaser`:** optional, Phaser-only: `originX/Y`, `flipX/Y`, `tint`, `scrollFactorX/Y`. Other engines ignore it.
- Validation: unknown kinds/shapes, duplicate ids and bad sprites are errors (object skipped); duplicate names, non-identifier names and unknown anchors are warnings.
