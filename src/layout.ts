import type { App, TFile } from "obsidian";
import {
  DEFAULT_COLOR,
  EXCLUDED_FOLDERS,
  MACRO_AREA_COLORS,
  PONTI_AREA,
  ROOT_AREA,
} from "./palette";

export interface GalaxyNode {
  id: string;
  file: TFile;
  label: string;
  area: string;
  color: string;
  degree: number;
  radius: number;
  neighbors: Set<string>;
  position: { x: number; y: number; z: number };
  basePosition: { x: number; y: number; z: number };
  clusterCenter: { x: number; y: number; z: number };
}

export interface GalaxyLink {
  source: string;
  target: string;
}

export interface MacroPair {
  a: string;
  b: string;
  weight: number;
}

export interface MacroGraph {
  areas: string[];
  pairs: MacroPair[];
  pairWeight: Map<string, number>;
  crossLinks: Map<string, number>;
  noteCount: Map<string, number>;
  tier: Map<string, "A" | "B" | "C">;
}

export interface GalaxyGraph {
  nodes: GalaxyNode[];
  links: GalaxyLink[];
  nodeById: Map<string, GalaxyNode>;
  maxDegree: number;
  macro: MacroGraph;
}

type Core = { x: number; y: number; z: number };

function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function isExcluded(path: string): boolean {
  return EXCLUDED_FOLDERS.has(topFolder(path));
}

// FNV-1a 32-bit — hash deterministico (jitter, starfield, nebula, tier init).
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashUnit(s: string, salt: string): number {
  return hash32(s + "|" + salt) / 4294967296;
}

export function macroKey(a: string, b: string): string {
  return a < b ? a + "|" + b : b + "|" + a;
}

// ============================================================
// MACRO GRAPH — pura, testabile. Deriva tier e peso da dati reali.
// ============================================================
export function buildMacroGraph(
  nodes: { area: string; degree: number }[],
  links: { source: string; target: string }[],
  areaOf: (id: string) => string
): MacroGraph {
  const areaSet = new Set<string>();
  const noteCount = new Map<string, number>();
  const crossLinks = new Map<string, number>();
  const pairWeight = new Map<string, number>();
  const pairs: MacroPair[] = [];

  for (const n of nodes) {
    areaSet.add(n.area);
    noteCount.set(n.area, (noteCount.get(n.area) ?? 0) + 1);
  }
  const areas = Array.from(areaSet).sort();

  for (const l of links) {
    const a = areaOf(l.source);
    const b = areaOf(l.target);
    if (a === b) continue;
    const key = macroKey(a, b);
    const w = (pairWeight.get(key) ?? 0) + 1;
    pairWeight.set(key, w);
  }
  for (const [key, weight] of pairWeight) {
    const [a, b] = key.split("|");
    pairs.push({ a, b, weight });
    crossLinks.set(a, (crossLinks.get(a) ?? 0) + weight);
    crossLinks.set(b, (crossLinks.get(b) ?? 0) + weight);
  }
  pairs.sort((p, q) => (q.weight - p.weight) || (p.a < q.a ? -1 : 1));
  for (const a of areas) if (!crossLinks.has(a)) crossLinks.set(a, 0);

  // Tier derivato dai dati reali: cross-links (peso reale), poi note, poi nome.
  // 08_Ponti è il cuore dei ponti per definizione → sempre Tier A.
  const ranked = [...areas].sort((x, y) => {
    if (x === PONTI_AREA) return -1;
    if (y === PONTI_AREA) return 1;
    return (
      (crossLinks.get(y) ?? 0) - (crossLinks.get(x) ?? 0) ||
      (noteCount.get(y) ?? 0) - (noteCount.get(x) ?? 0) ||
      (x < y ? -1 : 1)
    );
  });
  const nA = Math.max(2, Math.ceil(areas.length * 0.22));
  const nB = Math.max(3, Math.ceil(areas.length * 0.32));
  const tier = new Map<string, "A" | "B" | "C">();
  ranked.forEach((a, i) => {
    tier.set(a, i < nA ? "A" : i < nA + nB ? "B" : "C");
  });

  return { areas, pairs, pairWeight, crossLinks, noteCount, tier };
}

// ============================================================
// MACRO CENTERS — core galaxy + satellite constellations.
// Simulazione forza deterministica sui macro-nodi (nessun Math.random).
// ============================================================
export function computeMacroCenters(macro: MacroGraph): Map<string, Core> {
  const areas = [...macro.areas].sort();
  const centers = new Map<string, Core>();
  const anchors = new Map<string, Core>();
  const shells = new Map<string, number>();

  for (const area of areas) {
    const t = macro.tier.get(area) ?? "C";
    // Shell iniziale: A interno (core morbido), B media, C esterna.
    const shell =
      t === "A" ? 8 + hashUnit(area, "sa") * 16 : t === "B" ? 44 + hashUnit(area, "sb") * 24 : 80 + hashUnit(area, "sc") * 26;
    const theta = hashUnit(area, "mtheta") * Math.PI * 2;
    const cosPhi = 2 * hashUnit(area, "mphi") - 1;
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    shells.set(area, shell);
    const p = {
      x: shell * sinPhi * Math.cos(theta) * 1.15,
      y: shell * cosPhi * 0.55,
      z: shell * sinPhi * Math.sin(theta) * 1.05,
    };
    centers.set(area, p);
    anchors.set(area, { ...p });
  }

  // Ancora centrale per Ponti (relativamente centrale, non esattamente 0,0,0).
  const pontiAnchor: Core = {
    x: (hashUnit(PONTI_AREA, "pax") - 0.5) * 22,
    y: (hashUnit(PONTI_AREA, "pay") - 0.5) * 14,
    z: (hashUnit(PONTI_AREA, "pz") - 0.5) * 22,
  };
  if (centers.has(PONTI_AREA)) centers.set(PONTI_AREA, { ...pontiAnchor });

  const idx = new Map<string, number>();
  areas.forEach((a, i) => idx.set(a, i));
  const MIN_DIST = 42;

  for (let iter = 0; iter < 160; iter++) {
    const fx = new Map<string, Core>();
    const force = (id: string): Core => {
      let f = fx.get(id);
      if (!f) {
        f = { x: 0, y: 0, z: 0 };
        fx.set(id, f);
      }
      return f;
    };

    // Repulsione: separazione minima garantisce leggibilità dei cluster.
    for (let i = 0; i < areas.length; i++) {
      for (let j = i + 1; j < areas.length; j++) {
        const a = centers.get(areas[i])!;
        const b = centers.get(areas[j])!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dz = b.z - a.z;
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= MIN_DIST) continue;
        if (d < 0.001) {
          dx = 1;
          dy = 0.4;
          dz = 0.2;
          d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        const push = (MIN_DIST - d) * 0.5;
        force(areas[i]).x -= (dx / d) * push;
        force(areas[i]).y -= (dy / d) * push;
        force(areas[i]).z -= (dz / d) * push;
        force(areas[j]).x += (dx / d) * push;
        force(areas[j]).y += (dy / d) * push;
        force(areas[j]).z += (dz / d) * push;
      }
    }

    // Attrazione lungo i macro-edge reali: pesi alti → cluster più vicini.
    for (const p of macro.pairs) {
      const a = centers.get(p.a);
      const b = centers.get(p.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const w = Math.min(p.weight, 30);
      const rest = Math.max(34, 72 - w * 1.4);
      const k = 0.003 + w * 0.0008;
      const f = (k * (d - rest)) / d;
      force(p.a).x += dx * f;
      force(p.a).y += dy * f;
      force(p.a).z += dz * f;
      force(p.b).x -= dx * f;
      force(p.b).y -= dy * f;
      force(p.b).z -= dz * f;
    }

    // Pull morbido verso la shell di tier (core compatto, satelliti esterni).
    for (const area of areas) {
      const c = centers.get(area)!;
      const shell = shells.get(area)!;
      const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) || 1;
      const tx = (c.x / r) * shell;
      const ty = (c.y / r) * shell;
      const tz = (c.z / r) * shell;
      const f = force(area);
      f.x += (tx - c.x) * 0.008;
      f.y += (ty - c.y) * 0.008;
      f.z += (tz - c.z) * 0.008;
    }

    // Ponti rimane relativamente centrale.
    if (centers.has(PONTI_AREA)) {
      const f = force(PONTI_AREA);
      f.x += (pontiAnchor.x - centers.get(PONTI_AREA)!.x) * 0.05;
      f.y += (pontiAnchor.y - centers.get(PONTI_AREA)!.y) * 0.05;
      f.z += (pontiAnchor.z - centers.get(PONTI_AREA)!.z) * 0.05;
    }

    for (const area of areas) {
      const f = fx.get(area);
      if (!f) continue;
      const step = 1.1;
      const mag = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
      const s = mag > step ? step / mag : 1;
      const c = centers.get(area)!;
      c.x += f.x * s;
      c.y += f.y * s;
      c.z += f.z * s;
    }
  }

  // Outlier control: limita la distanza massima dei macro centers dal core.
  // maxMacroRadius derivato dalla dimensione reale del graph (note totali).
  let totalNotes = 0;
  for (const v of macro.noteCount.values()) totalNotes += v;
  const maxMacroRadius = Math.max(64, Math.min(115, 58 + 2.0 * Math.sqrt(Math.max(1, totalNotes))));
  for (const c of centers.values()) {
    const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
    if (r > maxMacroRadius) {
      // Soft-limit: gli outlier restano periferici ma non isolati.
      const newR = maxMacroRadius + (r - maxMacroRadius) * 0.12;
      const s = newR / r;
      c.x *= s;
      c.y *= s;
      c.z *= s;
    }
  }

  return centers;
}

// ============================================================
// FORMA CLUSTER — ellissoidi deterministiche per area (silhouette diverse).
// ============================================================
interface ClusterShape {
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  sz: number;
}

function clusterShape(area: string): ClusterShape {
  return {
    rx: (hashUnit(area, "srx") - 0.5) * 1.3,
    ry: (hashUnit(area, "sry") - 0.5) * 1.3,
    rz: (hashUnit(area, "srz") - 0.5) * 1.1,
    sx: 0.85 + hashUnit(area, "ssx") * 0.75,
    sy: 0.55 + hashUnit(area, "ssy") * 0.55,
    sz: 0.8 + hashUnit(area, "ssz") * 0.7,
  };
}

function applyShape(off: Core, shape: ClusterShape): Core {
  let x = off.x * shape.sx;
  let y = off.y * shape.sy;
  let z = off.z * shape.sz;
  let c = Math.cos(shape.rx);
  let s = Math.sin(shape.rx);
  const y1 = y * c - z * s;
  const z1 = y * s + z * c;
  y = y1;
  z = z1;
  c = Math.cos(shape.ry);
  s = Math.sin(shape.ry);
  const x1 = x * c + z * s;
  const z2 = -x * s + z * c;
  x = x1;
  z = z2;
  c = Math.cos(shape.rz);
  s = Math.sin(shape.rz);
  const x2 = x * c - y * s;
  const y2 = x * s + y * c;
  return { x: x2, y: y2, z };
}

// Offset deterministico in una sfera (uniforme via cbrt).
function deterministicOffset(path: string, radius: number): Core {
  const u = hashUnit(path, "u");
  const v = hashUnit(path, "v");
  const w = hashUnit(path, "w");
  const theta = u * Math.PI * 2;
  const phi = Math.acos(2 * v - 1);
  const r = radius * Math.cbrt(w);
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.sin(phi) * Math.sin(theta),
    z: r * Math.cos(phi),
  };
}

// ============================================================
// BUILD GRAPH — 1 file .md = 1 nodo, 1 wikilink risolto = 1 edge.
// ============================================================
export function buildGraph(app: App): GalaxyGraph {
  const files = app.vault.getMarkdownFiles().filter((f) => !isExcluded(f.path));

  const areaOf = (path: string): string => {
    const t = topFolder(path);
    return t === "" ? ROOT_AREA : t;
  };

  const nodes: GalaxyNode[] = [];
  const nodeById = new Map<string, GalaxyNode>();
  for (const f of files) {
    const area = areaOf(f.path);
    const node: GalaxyNode = {
      id: f.path,
      file: f,
      label: f.basename,
      area,
      color: MACRO_AREA_COLORS[area] ?? DEFAULT_COLOR,
      degree: 0,
      radius: 0.5,
      neighbors: new Set(),
      position: { x: 0, y: 0, z: 0 },
      basePosition: { x: 0, y: 0, z: 0 },
      clusterCenter: { x: 0, y: 0, z: 0 },
    };
    nodes.push(node);
    nodeById.set(f.path, node);
  }

  // Edge = solo wikilink risolti tra nodi inclusi.
  const linkKeys = new Set<string>();
  const links: GalaxyLink[] = [];
  const degree = new Map<string, number>();
  const bump = (id: string, n: number) => degree.set(id, (degree.get(id) ?? 0) + n);

  for (const f of files) {
    const resolved = app.metadataCache.resolvedLinks[f.path] ?? {};
    for (const [target, count] of Object.entries(resolved)) {
      if (!nodeById.has(target) || count <= 0) continue;
      bump(f.path, count);
      bump(target, count);
      nodeById.get(f.path)!.neighbors.add(target);
      nodeById.get(target)!.neighbors.add(f.path);
      const key = f.path < target ? f.path + "\u0000" + target : target + "\u0000" + f.path;
      if (!linkKeys.has(key)) {
        linkKeys.add(key);
        links.push({ source: f.path, target });
      }
    }
  }

  let maxDegree = 1;
  for (const n of nodes) {
    n.degree = degree.get(n.id) ?? 0;
    if (n.degree > maxDegree) maxDegree = n.degree;
  }

  // Degree → gerarchia visiva (core radius 0.25–1.40, scaling logaritmico).
  for (const n of nodes) {
    const t = Math.log(1 + n.degree) / Math.log(1 + maxDegree);
    n.radius = 0.25 + 1.15 * t;
  }

  // Macro graph dai dati reali (usato per tier, distanze e bridge).
  const macro = buildMacroGraph(
    nodes.map((n) => ({ area: n.area, degree: n.degree })),
    links,
    (id) => areaOf(id)
  );
  const cores = computeMacroCenters(macro);

  // Radius per cluster: compatto ma proporzionale alle note reali.
  const radii = new Map<string, number>();
  for (const [area, count] of macro.noteCount) {
    radii.set(area, 9 + 2.0 * Math.sqrt(count));
  }

  // Gerarchia interna: hub verso il centro del cluster, periferia verso l'esterno.
  for (const n of nodes) {
    const center = cores.get(n.area) ?? { x: 0, y: -14, z: 0 };
    const clusterRadius = radii.get(n.area) ?? 12;
    const t = Math.log(1 + n.degree) / Math.log(1 + maxDegree);
    const radial = clusterRadius * (1 - t * 0.55);
    const variance = 0.55 + 0.45 * hashUnit(n.id, "rv");
    const shape = clusterShape(n.area);
    const off = applyShape(deterministicOffset(n.id, radial * variance), shape);
    n.clusterCenter = { ...center };
    n.position = { x: center.x + off.x, y: center.y + off.y, z: center.z + off.z };
  }

  relaxLocally(nodes, links, cores);

  for (const n of nodes) n.basePosition = { ...n.position };

  return { nodes, links, nodeById, maxDegree, macro };
}

// Forza locale interna ai cluster — deterministica, ordine fisso per path.
function relaxLocally(nodes: GalaxyNode[], links: GalaxyLink[], cores: Map<string, Core>): void {
  const ITERATIONS = 70;

  const byCluster = new Map<string, GalaxyNode[]>();
  for (const n of nodes) {
    let arr = byCluster.get(n.area);
    if (!arr) {
      arr = [];
      byCluster.set(n.area, arr);
    }
    arr.push(n);
  }

  const sortedLinks = links
    .map((l) => ({ a: l.source, b: l.target }))
    .sort((e1, e2) => (e1.a + e1.b < e2.a + e2.b ? -1 : 1));

  const idx = new Map<string, GalaxyNode>();
  for (const n of nodes) idx.set(n.id, n);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const fx = new Map<string, Core>();
    const force = (id: string): Core => {
      let f = fx.get(id);
      if (!f) {
        f = { x: 0, y: 0, z: 0 };
        fx.set(id, f);
      }
      return f;
    };

    // Repulsione locale (evita overlap, preserva la forma ellissoidale).
    for (const [, arr] of byCluster) {
      const d0 = 7.5;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          let dx = b.position.x - a.position.x;
          let dy = b.position.y - a.position.y;
          let dz = b.position.z - a.position.z;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > d0 * d0) continue;
          if (d2 < 0.01) {
            dx = 0.5;
            dy = 0.25;
            dz = 0.125;
            d2 = dx * dx + dy * dy + dz * dz;
          }
          const d = Math.sqrt(d2);
          const f = (0.55 * (d0 - d)) / d;
          force(a.id).x -= dx * f;
          force(a.id).y -= dy * f;
          force(a.id).z -= dz * f;
          force(b.id).x += dx * f;
          force(b.id).y += dy * f;
          force(b.id).z += dz * f;
        }
      }
    }

    // Molle: intra-area compatte, inter-area tenue coesione (ponti visivi).
    for (const e of sortedLinks) {
      const a = idx.get(e.a);
      const b = idx.get(e.b);
      if (!a || !b) continue;
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const dz = b.position.z - a.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const sameArea = a.area === b.area;
      const rest = sameArea ? 12 : d * 0.97;
      const k = sameArea ? 0.025 : 0.005;
      const f = (k * (d - rest)) / d;
      force(a.id).x += dx * f;
      force(a.id).y += dy * f;
      force(a.id).z += dz * f;
      force(b.id).x -= dx * f;
      force(b.id).y -= dy * f;
      force(b.id).z -= dz * f;
    }

    // Pull verso il centro del macro-cluster (coesione della costellazione).
    for (const n of nodes) {
      const core = cores.get(n.area);
      if (!core) continue;
      const f = force(n.id);
      f.x += (core.x - n.position.x) * 0.01;
      f.y += (core.y - n.position.y) * 0.01;
      f.z += (core.z - n.position.z) * 0.01;
    }

    for (const n of nodes) {
      const f = fx.get(n.id);
      if (!f) continue;
      const step = 1.2;
      const mag = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
      const s = mag > step ? step / mag : 1;
      n.position.x += f.x * s;
      n.position.y += f.y * s;
      n.position.z += f.z * s;
    }
  }
}

// Spread: allontana/avvicina i core delle costellazioni (jitter invariato).
export function applySpread(nodes: GalaxyNode[], spread: number): void {
  for (const n of nodes) {
    n.position.x = n.clusterCenter.x * spread + (n.basePosition.x - n.clusterCenter.x);
    n.position.y = n.clusterCenter.y * spread + (n.basePosition.y - n.clusterCenter.y);
    n.position.z = n.clusterCenter.z * spread + (n.basePosition.z - n.clusterCenter.z);
  }
}
