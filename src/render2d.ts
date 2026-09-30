// Galaxy 2D — renderer Canvas 2D. Stelle e aloni sono decorazione: mai knowledge node.
import { hash32 } from "./layout";
import { areaHalos, type Sim2D } from "./layout2d";
import { NEON_AREA_COLORS, NEON_DEFAULT } from "./palette";

export interface G2DSettings {
  glow: number;
  halos: number;
  links: number;
  stars: number;
}

export const DEFAULT_G2D: G2DSettings = {
  glow: 1,
  halos: 1,
  links: 1,
  stars: 1,
};

export interface Camera2D {
  x: number;
  y: number;
  k: number;
}

export interface DrawState {
  hover: number | null;
  selected: number | null;
  fade: number; // 0..1 intro
  labelZoom: number; // soglia zoom per le etichette degli hub
}

const SPRITE_SIZE = 128;

// Neon attenuato: 85% del colore + 15% di blu notte, per una saturazione meno aggressiva.
const softCache = new Map<string, string>();
export function neonColor(area: string): string {
  const base = NEON_AREA_COLORS[area] ?? NEON_DEFAULT;
  let c = softCache.get(base);
  if (!c) {
    const [r, g, b] = hexToRgb(base);
    const [br, bgc, bb] = [11, 16, 32];
    const mix = (v: number, w: number): string => Math.round(v * 0.85 + w * 0.15).toString(16).padStart(2, "0");
    c = "#" + mix(r, br) + mix(g, bgc) + mix(b, bb);
    softCache.set(base, c);
  }
  return c;
}

// Mescolatore intero (Murmur3 fmix32): valori scorrelati anche per indici consecutivi.
function mixUnit(i: number, salt: number): number {
  let h = (i * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export class Renderer2D {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private starCanvas: HTMLCanvasElement | null = null;
  private starKey = "";
  private font: string;
  private neighbors: Set<number>[] = [];
  private labelRank = new Set<number>();
  private labels: string[] = [];

  constructor(host: HTMLElement, private readonly mobile: boolean) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "asb-g2d-canvas";
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");
    this.ctx = ctx;
    const f = getComputedStyle(document.body).getPropertyValue("--font-interface").trim();
    this.font = f || "system-ui, -apple-system, sans-serif";
  }

  setGraph(sim: Sim2D, labels: string[]): void {
    this.labels = labels;
    this.neighbors = sim.nodes.map(() => new Set<number>());
    for (const l of sim.links) {
      this.neighbors[l.a].add(l.b);
      this.neighbors[l.b].add(l.a);
    }
    // Etichette permanenti (con zoom): circa il 12% delle note più collegate.
    const ranked = sim.nodes
      .map((n, i) => ({ i, d: n.degree }))
      .sort((p, q) => q.d - p.d || p.i - q.i);
    const top = Math.max(5, Math.ceil(ranked.length * 0.06));
    this.labelRank = new Set(ranked.slice(0, top).map((r) => r.i));
  }

  neighborsOf(i: number): Set<number> {
    return this.neighbors[i] ?? new Set();
  }

  resize(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  worldToScreen(cam: Camera2D, x: number, y: number): { x: number; y: number } {
    return { x: (x - cam.x) * cam.k + this.width / 2, y: (y - cam.y) * cam.k + this.height / 2 };
  }

  screenToWorld(cam: Camera2D, sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.width / 2) / cam.k + cam.x, y: (sy - this.height / 2) / cam.k + cam.y };
  }

  hitTest(sim: Sim2D, cam: Camera2D, sx: number, sy: number): number | null {
    const w = this.screenToWorld(cam, sx, sy);
    let best: number | null = null;
    let bestD = Infinity;
    const slop = 6 / cam.k;
    sim.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < n.r + slop && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  fitCamera(sim: Sim2D): Camera2D {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of sim.nodes) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    if (!isFinite(minX)) return { x: 0, y: 0, k: 1 };
    const pad = 0.86;
    const k = Math.min((this.width * pad) / (maxX - minX || 1), (this.height * pad) / (maxY - minY || 1));
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: Math.min(Math.max(k, 0.2), 4) };
  }

  // Sprite di glow pre-renderizzato per colore: alone morbido + nucleo chiaro.
  private sprite(color: string): HTMLCanvasElement {
    let c = this.sprites.get(color);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = SPRITE_SIZE;
    const g = c.getContext("2d")!;
    const m = SPRITE_SIZE / 2;
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, rgba(color, 0.8));
    grad.addColorStop(0.14, rgba(color, 0.35));
    grad.addColorStop(0.4, rgba(color, 0.08));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    this.sprites.set(color, c);
    return c;
  }

  // Campo stellare fisso (screen space), rigenerato solo a resize / cambio densità.
  private stars(settings: G2DSettings): HTMLCanvasElement {
    const count = Math.round((this.mobile ? 110 : 220) * settings.stars);
    const key = `${this.canvas.width}x${this.canvas.height}:${count}`;
    if (this.starCanvas && this.starKey === key) return this.starCanvas;
    const c = this.starCanvas ?? document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < count; i++) {
      const x = mixUnit(i, 1) * c.width;
      const y = mixUnit(i, 2) * c.height;
      const b = mixUnit(i, 3);
      const r = (0.35 + b * 0.7) * this.dpr;
      g.fillStyle = `rgba(210,220,255,${0.05 + b * 0.2})`;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    this.starCanvas = c;
    this.starKey = key;
    return c;
  }

  draw(sim: Sim2D, cam: Camera2D, state: DrawState, settings: G2DSettings): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // Sfondo: blu notte sfumato verso il nero.
    const bg = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H / 2, Math.max(W, H) * 0.72);
    bg.addColorStop(0, "#131B36");
    bg.addColorStop(0.45, "#0B1020");
    bg.addColorStop(1, "#010103");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    if (settings.stars > 0) ctx.drawImage(this.stars(settings), 0, 0);

    ctx.setTransform(cam.k * this.dpr, 0, 0, cam.k * this.dpr, (this.width / 2 - cam.x * cam.k) * this.dpr, (this.height / 2 - cam.y * cam.k) * this.dpr);

    const focus = state.selected ?? state.hover;
    const lit = focus !== null ? new Set<number>([focus, ...this.neighborsOf(focus)]) : null;
    const fade = state.fade;

    // Aloni d'area (nebulose additive).
    if (settings.halos > 0) {
      ctx.globalCompositeOperation = "lighter";
      for (const h of areaHalos(sim)) {
        const color = neonColor(h.area);
        const r = h.r * 1.9;
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r);
        const a = 0.07 * settings.halos * fade * (lit ? 0.5 : 1);
        g.addColorStop(0, rgba(color, a));
        g.addColorStop(0.5, rgba(color, a * 0.4));
        g.addColorStop(1, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Link: curve morbide con gradiente tra i colori delle due aree (non additive).
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    for (const l of sim.links) {
      const p = sim.nodes[l.a];
      const q = sim.nodes[l.b];
      const on = lit ? l.a === focus || l.b === focus : false;
      const alpha = Math.min(1, (lit ? (on ? 0.55 : 0.02) : 0.06) * settings.links) * fade;
      if (alpha <= 0.002) continue;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const side = hash32(p.id + q.id) & 1 ? 1 : -1;
      const bend = 0.14 * side;
      const cx = mx - dy * bend;
      const cy = my + dx * bend;
      const cp = neonColor(p.area);
      const cq = neonColor(q.area);
      if (cp === cq) {
        ctx.strokeStyle = rgba(cp, alpha);
      } else {
        const g = ctx.createLinearGradient(p.x, p.y, q.x, q.y);
        g.addColorStop(0, rgba(cp, alpha));
        g.addColorStop(1, rgba(cq, alpha));
        ctx.strokeStyle = g;
      }
      ctx.lineWidth = (on ? 1.2 : 0.6) / Math.sqrt(cam.k);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(cx, cy, q.x, q.y);
      ctx.stroke();
    }

    // Nodi: glow additivo + nucleo.
    const glow = settings.glow * (this.mobile ? 0.7 : 1);
    sim.nodes.forEach((n, i) => {
      const color = neonColor(n.area);
      const dim = lit && !lit.has(i) ? 0.14 : 1;
      const boost = i === focus ? 1.5 : 1;
      if (glow > 0) {
        const s = n.r * (3.5 + 1.5 * glow) * (i === focus ? 1.8 : 1);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, (i === focus ? 0.6 : 0.28) * glow) * dim * fade;
        ctx.drawImage(this.sprite(color), n.x - s / 2, n.y - s / 2, s, s);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = dim * fade;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 0.62 * boost, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${i === focus ? 0.7 : 0.25})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 0.22 * boost, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // Etichette degli hub quando si zooma (e dei vicini della nota attiva).
    const showHubs = cam.k >= state.labelZoom;
    if (showHubs || lit) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = `500 11px ${this.font}`;
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      // Prima le note più collegate: vincono loro se due etichette si sovrappongono.
      const order = sim.nodes.map((_, i) => i).sort((a, b) => sim.nodes[b].degree - sim.nodes[a].degree || a - b);
      for (const i of order) {
        const n = sim.nodes[i];
        const wanted = lit ? lit.has(i) && i !== focus : this.labelRank.has(i);
        if (!wanted) continue;
        const s = this.worldToScreen(cam, n.x, n.y);
        const label = this.labels[i] ?? n.id;
        const w = ctx.measureText(label).width;
        const y = s.y + n.r * cam.k * 0.7 + 4;
        const box = { x0: s.x - w / 2 - 3, y0: y - 1, x1: s.x + w / 2 + 3, y1: y + 14 };
        if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        placed.push(box);
        ctx.fillStyle = `rgba(222,228,250,${0.55 * fade})`;
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.fillText(label, s.x, y);
      }
      ctx.shadowBlur = 0;
    }
  }
}
