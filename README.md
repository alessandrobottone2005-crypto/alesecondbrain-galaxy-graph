# AleSecondBrain Galaxy Graph

Cinematic 3D galaxy view of the AleSecondBrain Obsidian vault: one star per real Markdown note, one filament per resolved wikilink.

## Install (BRAT)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin in Obsidian.
2. BRAT → Add plugin → `alessandrobottone2005-crypto/alesecondbrain-galaxy-graph`
3. Enable **AleSecondBrain Galaxy Graph**.
4. Command Palette → **Open AleSecondBrain Galaxy Graph**.

Requires Obsidian ≥ 1.5.0. Works on desktop and mobile (`isDesktopOnly: false`).

## Data rules

- 1 real `.md` file = 1 node
- 1 resolved wikilink = 1 edge
- Stars, nebula and dust are decoration — never knowledge nodes
- No invented nodes or links

## Build (development)

```sh
npm ci
npm run build
npm run typecheck
npm run sanity
node --check main.js
```

## Notes

- Visual preferences live in the vault-local `data.json` (not shipped in this repository).
- Source of truth for the knowledge content: the Obsidian vault, not this plugin.
