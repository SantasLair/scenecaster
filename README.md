<p align="center"><img src="docs/images/logo.svg" width="96" alt="Scenecaster logo"></p>

# Scenecaster

> Stop guessing coordinates. Just drag it.

A lightweight visual scene editor for **Phaser 4** games, built with Electron + React. It sits beside your project instead of inside it: drag sprites into position, tweak properties in the inspector, and save the layout as a plain JSON file that you, or an AI assistant writing your code, can read. Design mode needs no changes to your game.

*Scenecaster started as a fork of [Phaser Forge Editor](https://github.com/XLevi9/Phaser-Forge-Editor).*

![Status](https://img.shields.io/badge/status-early%20development-orange)
![Phaser](https://img.shields.io/badge/Phaser-4.x-blue)
![Electron](https://img.shields.io/badge/Electron-latest-teal)

![Scenecaster: design mode, then live mode inspecting and editing a running Phaser game](docs/images/hero.gif)

---

## Why

Placing things in a Phaser game by typing coordinates and reloading is slow. Scenecaster lets you drag them into place instead. The layout is saved as a JSON file, and your code, or the AI writing it, reads the positions from there.

---

## Features

- **Visual viewport** — Phaser 4 scene rendered at your game's exact canvas resolution (e.g. 1280×720). What you see = what you get.
- **Click to select** — bounding box + gizmo handles appear on selected objects
- **Tool modes** — Select · Move · Rotate · Scale (Q/W/E/R)
- **Inspector** — edit x, y, rotation, scaleX/Y, alpha, tint, visible, depth, originX/Y with live feedback
- **Origin presets** — 9-point grid (TL/TC/TR/CL/C/CR/BL/BC/BR) so origin always matches your game
- **Asset browser** — scan your project's `/assets` folder, drag images onto the viewport
- **Primitives** — add rectangles, circles and triangles as placeholders
- **Camera pan/zoom** — middle mouse to pan, scroll wheel to zoom toward cursor, F to reset
- **Hierarchy panel** — click to select, right-click for rename/duplicate/delete, per-object lock and visibility
- **Undo/Redo** — Ctrl+Z / Ctrl+Y, up to 100 steps
- **Snap to grid** — toggleable 32px snap
- **Save / load** — layout stored in `forge-scene.json` in your project (Ctrl+S)
- **Per-project config** — canvas size and dev script saved to `.phaser-forge.json`
- **Live mode (optional)** — run your game's dev server from the editor, inspect and move objects of the running game through a small bridge script. This is the only feature that adds a file to your project; everything else works without it

---

## How It Works

The editor has two modes.

**Design mode** — the editor renders its own Phaser 4 scene. You place objects visually, read the coordinates from the inspector, and write them into your game code.

```
Editor viewport (1280×720 canvas)
  → drag sprite to x=935, y=115
  → inspector shows: x: 935, y: 115, originX: 0.5

Your game code:
  this.add.image(935, 115, 'barn').setOrigin(0.5);  ← exact match ✅
```

Design mode needs no changes to your game project.

**Live mode (optional)** — press **▶ Run Game** and the editor runs your project's dev script (`dev`, `dev:*` or `*:dev:*` from `package.json`), then loads the game from its localhost URL. Running the game changes nothing in your project. To inspect and edit it, you also install the bridge, which does modify your project: click **Install Bridge** and it copies `phaser-forge-bridge.js` (plus a `.d.ts` for TypeScript) to your project root and prints the exact import line for your entry file. Add it **once** — not in every scene — and pass your game instance:

```js
// src/main.js (entry from index.html)
import StartGame from './game/main';
import { installForgeBridge } from '../phaser-forge-bridge.js';

document.addEventListener('DOMContentLoaded', () => {
  installForgeBridge(StartGame('game-container')); // StartGame returns the Phaser.Game
});
```

One install covers every scene. The bridge does nothing outside the editor, so it is safe to leave in; to keep it out of production builds, load it only in dev:

```js
if (import.meta.env.DEV) import('../phaser-forge-bridge.js').then(m => m.installForgeBridge(game));
```

If you can't pass the game, `import '../phaser-forge-bridge.js'` alone also works when the game is on `window.game` or `window.__phaserGame`. Switch to **🎯 Edit** to click objects in the running game, drag them, and tweak position, rotation, scale, alpha, depth and visibility. Live edits change the running game only; copy the values into your code.

---

## Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+
- A Phaser 4 game project (for the asset browser and coordinate reference)

### Install & Run

```bash
git clone https://github.com/SantasLair/scenecaster.git
cd scenecaster
npm install
npm run dev
```

### Open a Project

1. Click **📁 Open Project** in the toolbar
2. Select your Phaser 4 project folder
3. Enter your game's canvas size (e.g. `1280 × 720`) — saved to `.phaser-forge.json` for next time
4. Drag assets from the **Assets** panel onto the viewport

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Electron |
| UI | React + TypeScript + Tailwind |
| Build | Vite (via electron-vite) |
| Game renderer | Phaser 4 (in iframe) |
| State | Zustand |
| Communication | `postMessage` (React ↔ editor iframe / live game bridge) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Q` | Select tool |
| `W` | Move tool |
| `E` | Rotate tool |
| `R` | Scale tool |
| `F` | Reset camera view |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save scene |
| `Del` | Delete selected object |
| `Esc` | Deselect |
| Middle mouse | Pan camera |
| Scroll wheel | Zoom camera |

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md). Next up: a more reliable scene file (multiple scenes, reload when it changes on disk) and importing assets into your project from the editor. The earlier [docs/ROADMAP.md](docs/ROADMAP.md) is the original plan this one replaces.

---

## License

[MIT](LICENSE) — built for personal use first, open to whoever finds it useful.
