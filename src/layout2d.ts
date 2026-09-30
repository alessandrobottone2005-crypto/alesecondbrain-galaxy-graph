// Galaxy 2D — layout puro e deterministico (nessun Math.random, nessuna dipendenza Obsidian).
// 1 nota = 1 nodo, 1 wikilink risolto = 1 arco: qui arrivano solo dati reali.
import { hashUnit } from "./layout";
import { CLUSTER_ORDER, PONTI_AREA } from "./palette";

export interface Layout2DInputNode {
  id: string;
  area: string;
  degree: number;
}

export interface Layout2DInputLink {
  source: string;
  target: string;
}

export interface SimNode {
  id: string;
  area: string;
  degree: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimLink {
  a: number;
  b: number;
  sameArea: boolean;
}

export interface Sim2D {
  nodes: SimNode[];
  links: SimLink[];
  anchors: Map<string, { x: number; y: number }>;
  worldRadius: number;
  alpha: number;
}

const ALPHA_MIN = 0.004;
const ALPHA_DECAY = 0.985;
const VELOCITY_DECAY = 0.58;
const CHARGE = 520;
const LINK_DISTANCE = 26;
const LINK_K_SAME = 0.07;
const LINK_K_CROSS = 0.018;
const COHESION_K = 0.014;
const DISC_K = 0.08;
const CENTER_K = 0.006;

// Ordine stabile delle aree: CLUSTER_ORDER, poi le altre in ordine alfabetico.
export function orderAreas(areas: Iterable<string>): string[] {
  const set = new Set(areas);
  const known = CLUSTER_ORDER.filter((a) => set.has(a));
  const rest = Array.from(set)
    .filter((a) => !CLUSTER_ORDER.includes(a) && a !== PONTI_AREA)
    .sort();
  return [...known, ...rest];
}

// Ancore delle aree su un anello; archi proporzionali a sqrt(note). 08-ponti al centro.
export function computeAnchors2D(
  counts: Map<string, number>,
  worldRadius: number
): Map<string, { x: number; y: number }> {
  const anchors = new Map<string, { x: number; y: number }>();
  const ring = orderAreas(counts.keys());
  const weights = ring.map((a) => Math.sqrt(counts.get(a) ?? 1));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const ringR = worldRadius * 0.56;
  let acc = 0;
  ring.forEach((area, i) => {
    const mid = acc + weights[i] / 2;
    acc += weights[i];
    const angle = -Math.PI / 2 + (mid / total) * Math.PI * 2;
    anchors.set(area, { x: Math.cos(angle) * ringR, y: Math.sin(angle) * ringR });
  });
  if (counts.has(PONTI_AREA)) anchors.set(PONTI_AREA, { x: 0, y: 0 });
  return anchors;
}

export function nodeRadius(degree: number, maxDegree: number): number {
  const t = Math.log(1 + degree) / Math.log(1 + Math.max(1, maxDegree));
  return 2.2 + 7.8 * t;
}

export function createSim2D(
  nodesIn: Layout2DInputNode[],
  linksIn: Layout2DInputLink[],
  previous?: Map<string, { x: number; y: number }>
): Sim2D {
  const sorted = [...nodesIn].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const counts = new Map<string, number>();
  let maxDegree = 1;
  for (const n of sorted) {
    counts.set(n.area, (counts.get(n.area) ?? 0) + 1);
    if (n.degree > maxDegree) maxDegree = n.degree;
  }
  const worldRadius = 60 + 26 * Math.sqrt(sorted.length);
  const anchors = computeAnchors2D(counts, worldRadius);

  const index = new Map<string, number>();
  const nodes: SimNode[] = sorted.map((n, i) => {
    index.set(n.id, i);
    const anchor = anchors.get(n.area) ?? { x: 0, y: 0 };
    const spread = 8 + 9 * Math.sqrt(counts.get(n.area) ?? 1);
    const prev = previous?.get(n.id);
    const angle = hashUnit(n.id, "a2d") * Math.PI * 2;
    const dist = spread * Math.sqrt(hashUnit(n.id, "r2d"));
    return {
      id: n.id,
      area: n.area,
      degree: n.degree,
      r: nodeRadius(n.degree, maxDegree),
      x: prev ? prev.x : anchor.x + Math.cos(angle) * dist,
      y: prev ? prev.y : anchor.y + Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
    };
  });

  const links: SimLink[] = [];
  for (const l of linksIn) {
    const a = index.get(l.source);
    const b = index.get(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    links.push({ a, b, sameArea: nodes[a].area === nodes[b].area });
  }
  links.sort((p, q) => p.a - q.a || p.b - q.b);

  return { nodes, links, anchors, worldRadius, alpha: previous && previous.size > 0 ? 0.35 : 1 };
}

// Un passo di simulazione. Restituisce true finché il layout si sta ancora muovendo.
export function stepSim2D(sim: Sim2D): boolean {
  if (sim.alpha < ALPHA_MIN) return false;
  const { nodes, links, anchors, worldRadius } = sim;
  const alpha = sim.alpha;
  const n = nodes.length;

  // Repulsione (O(n²): adatta a qualche centinaio di note).
  for (let i = 0; i < n; i++) {
    const p = nodes[i];
    for (let j = i + 1; j < n; j++) {
      const q = nodes[j];
      let dx = q.x - p.x;
      let dy = q.y - p.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1e-6) {
        // Nodi sovrapposti: separazione deterministica.
        dx = (j - i) * 0.01;
        dy = 0.01;
        d2 = dx * dx + dy * dy;
      }
      const minD = p.r + q.r + 3;
      const f = (CHARGE * alpha) / Math.max(d2, minD * minD);
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      p.vx -= fx;
      p.vy -= fy;
      q.vx += fx;
      q.vy += fy;
    }
  }

  // Molle sui link: forti dentro l'area (petali), deboli tra aree.
  for (const l of links) {
    const p = nodes[l.a];
    const q = nodes[l.b];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const target = LINK_DISTANCE + p.r + q.r;
    const k = (l.sameArea ? LINK_K_SAME : LINK_K_CROSS) * alpha;
    const f = ((d - target) / d) * k;
    const wp = q.degree / (p.degree + q.degree || 1);
    const wq = 1 - wp;
    p.vx += dx * f * wp;
    p.vy += dy * f * wp;
    q.vx -= dx * f * wq;
    q.vy -= dy * f * wq;
  }

  // Coesione verso l'ancora dell'area + contenimento in un disco.
  for (const p of nodes) {
    const a = anchors.get(p.area) ?? { x: 0, y: 0 };
    p.vx += (a.x - p.x) * COHESION_K * alpha;
    p.vy += (a.y - p.y) * COHESION_K * alpha;
    p.vx -= p.x * CENTER_K * alpha;
    p.vy -= p.y * CENTER_K * alpha;
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    if (r > worldRadius) {
      const f = ((r - worldRadius) / r) * DISC_K;
      p.vx -= p.x * f;
      p.vy -= p.y * f;
    }
  }

  for (const p of nodes) {
    p.vx *= VELOCITY_DECAY;
    p.vy *= VELOCITY_DECAY;
    p.x += p.vx;
    p.y += p.vy;
  }

  sim.alpha *= ALPHA_DECAY;
  return sim.alpha >= ALPHA_MIN;
}

export function runSim2D(sim: Sim2D, maxSteps = 600): void {
  for (let i = 0; i < maxSteps && stepSim2D(sim); i++) {
    /* assestamento sincrono */
  }
}

// Baricentro e raggio (RMS) di ogni area: base degli aloni decorativi.
export function areaHalos(sim: Sim2D): { area: string; x: number; y: number; r: number; count: number }[] {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  for (const p of sim.nodes) {
    const a = acc.get(p.area) ?? { x: 0, y: 0, n: 0 };
    a.x += p.x;
    a.y += p.y;
    a.n += 1;
    acc.set(p.area, a);
  }
  const out: { area: string; x: number; y: number; r: number; count: number }[] = [];
  for (const [area, a] of acc) {
    const cx = a.x / a.n;
    const cy = a.y / a.n;
    let s = 0;
    for (const p of sim.nodes) if (p.area === area) s += (p.x - cx) ** 2 + (p.y - cy) ** 2;
    out.push({ area, x: cx, y: cy, r: Math.sqrt(s / a.n) + 24, count: a.n });
  }
  return out.sort((p, q) => (p.area < q.area ? -1 : 1));
}
