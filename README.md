# AleSecondBrain Galaxy Graph

Graph views for the AleSecondBrain Obsidian vault:

- **Galaxy 2D** (default, since 0.2.0): neon 2D graph on a night-blue background, soft halos per area, curved links, hover to light up a note and its neighbours, zoom/pan/pinch, "Apri nota".
- **Galaxy 3D**: the original cinematic 3D galaxy.

One real Markdown note = one node, one resolved wikilink = one edge.

## Install (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin in Obsidian.
2. BRAT → Add plugin → `alessandrobottone2005-crypto/alesecondbrain-galaxy-graph`
3. Enable **AleSecondBrain Galaxy Graph**.
4. Open the graph:
   - ribbon icon **network**, or Command Palette → **Open AleSecondBrain Graph (2D)**;
   - Command Palette → **Open AleSecondBrain Galaxy Graph (3D)** for the 3D view.

Requires Obsidian ≥ 1.5.0. Works on desktop and mobile (`isDesktopOnly: false`).

## Data rules

- 1 real `.md` file = 1 node
- 1 resolved wikilink = 1 edge
- Stars, halos, nebula and dust are decoration — never knowledge nodes
- No invented nodes or links; deterministic layout (no `Math.random`)
- Private notes under `00-contesto/riservato/` are never shown

## Source

- 2D: `src/layout2d.ts` (force layout), `src/render2d.ts` (Canvas 2D renderer), `src/view2d.ts` (Obsidian view, HUD: Glow, Aloni, Link, Stelle)
- 3D: `src/layout.ts`, `src/galaxy.ts`, `src/motion.ts`, `src/view.ts`
- Shared: `src/palette.ts` (area colors, neon palette, exclusions), `src/main.ts`

## Build (development)

```sh
npm ci
npm run build
npm run typecheck
npm run sanity
node --check main.js
```

## Notes

- Visual preferences live in the vault-local `data.json` (not shipped in this repository): 3D settings at the root, 2D settings under `g2d`.
- Source of truth for the knowledge content: the Obsidian vault, not this plugin.
