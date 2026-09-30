import { ItemView, Platform, type TFile, WorkspaceLeaf } from "obsidian";
import { buildGraph } from "./layout";
import { createSim2D, runSim2D, stepSim2D, type Sim2D } from "./layout2d";
import { DEFAULT_G2D, Renderer2D, type Camera2D, type G2DSettings } from "./render2d";

export const VIEW_TYPE_GRAPH_2D = "alesecondbrain-graph-2d-view";

const AREA_LABELS: Record<string, string> = {
  "00-contesto": "Contesto",
  "00-home": "Home",
  "00-inbox": "Inbox",
  "01-universita": "Università",
  "02-portfolio-progetti": "Portfolio e progetti",
  "03-fumetti-collezioni": "Fumetti e collezioni",
  "04-acquisti-spese": "Acquisti e spese",
  "05-letture-media": "Letture e media",
  "06-persone": "Persone",
  "07-risorse": "Risorse",
  "08-ponti": "Ponti",
  "09-magia-illusionismo": "Magia e illusionismo",
  "10-daily": "Daily",
  "11-weekly": "Weekly",
};

interface G2DHost {
  loadG2DSettings(): Promise<Partial<G2DSettings>>;
  saveG2DSettings(settings: G2DSettings): Promise<void>;
}

export class Graph2DView extends ItemView {
  private renderer: Renderer2D | null = null;
  private sim: Sim2D | null = null;
  private files: TFile[] = [];
  private cam: Camera2D = { x: 0, y: 0, k: 1 };
  private settings: G2DSettings = { ...DEFAULT_G2D };
  private hover: number | null = null;
  private selected: number | null = null;
  private fade = 1;
  private introStart = 0;
  private frame: number | null = null;
  private dirty = true;
  private autoFit = true;
  private fitK = 1;
  private reducedMotion = false;
  private labelEl: HTMLElement | null = null;
  private openBtn: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = 0;
  private pinchDist = 0;
  private rebuildTimer: number | null = null;
  private saveTimer: number | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: G2DHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GRAPH_2D;
  }

  getDisplayText(): string {
    return "AleSecondBrain Graph";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("asb-g2d");
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.settings = { ...DEFAULT_G2D, ...(await this.plugin.loadG2DSettings()) };

    this.host = container.createDiv({ cls: "asb-g2d-host" });
    this.labelEl = container.createDiv({ cls: "asb-gg-label" });
    this.openBtn = container.createEl("button", { cls: "asb-gg-open is-hidden", text: "Apri nota" });
    this.openBtn.addEventListener("click", () => this.openSelected());
    this.buildHud(container);

    this.renderer = new Renderer2D(this.host, Platform.isMobile);
    this.renderer.resize();
    this.bindPointer(this.renderer.canvas);

    this.resizeObs = new ResizeObserver(() => {
      this.renderer?.resize();
      if (this.autoFit && this.sim && this.renderer) {
        this.cam = this.renderer.fitCamera(this.sim);
        this.fitK = this.cam.k;
      }
      this.requestDraw();
    });
    this.resizeObs.observe(this.host);

    this.rebuild(false);

    const scheduleIfMd = (path: string): void => {
      if (path.endsWith(".md")) this.scheduleRebuild();
    };
    this.registerEvent(this.app.vault.on("create", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
  }

  async onClose(): Promise<void> {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.resizeObs?.disconnect();
    this.renderer = null;
    this.sim = null;
  }

  // ============================================================
  // Grafo: solo note reali e wikilink risolti (buildGraph).
  // ============================================================
  private rebuild(keepPositions: boolean): void {
    if (!this.renderer) return;
    const graph = buildGraph(this.app);
    const previous = new Map<string, { x: number; y: number }>();
    if (keepPositions && this.sim) for (const n of this.sim.nodes) previous.set(n.id, { x: n.x, y: n.y });

    const selectedId = this.selected !== null ? this.sim?.nodes[this.selected]?.id : undefined;
    this.sim = createSim2D(
      graph.nodes.map((n) => ({ id: n.id, area: n.area, degree: n.degree })),
      graph.links,
      keepPositions ? previous : undefined
    );
    const byId = graph.nodeById;
    this.files = this.sim.nodes.map((n) => byId.get(n.id)!.file);
    const labels = this.files.map((f) => {
      const title = this.app.metadataCache.getFileCache(f)?.frontmatter?.title;
      return typeof title === "string" && title.trim() ? title.trim() : f.basename;
    });
    this.renderer.setGraph(this.sim, labels);

    this.hover = null;
    this.selected = selectedId ? this.sim.nodes.findIndex((n) => n.id === selectedId) : null;
    if (this.selected === -1) this.selected = null;
    this.updateSelectionUi();

    if (!keepPositions) {
      if (this.reducedMotion) {
        runSim2D(this.sim);
        this.fade = 1;
      } else {
        // Pre-assestamento parziale, poi l'ultima parte si vede animata.
        for (let i = 0; i < 160; i++) stepSim2D(this.sim);
        this.fade = 0;
        this.introStart = performance.now();
      }
      this.autoFit = true;
      this.cam = this.renderer.fitCamera(this.sim);
      this.fitK = this.cam.k;
    }
    this.requestDraw();
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild(true);
    }, 900);
  }

  // ============================================================
  // Loop di rendering: gira solo mentre qualcosa si muove.
  // ============================================================
  private requestDraw(): void {
    this.dirty = true;
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.frame = null;
    if (!this.renderer || !this.sim) return;
    let moving = false;

    if (this.fade < 1) {
      this.fade = Math.min(1, (performance.now() - this.introStart) / 900);
      moving = true;
    }
    if (!this.reducedMotion && stepSim2D(this.sim)) {
      stepSim2D(this.sim);
      moving = true;
      if (this.autoFit) {
        const target = this.renderer.fitCamera(this.sim);
        this.fitK = target.k;
        this.easeCamera(target);
      }
    }

    if (moving || this.dirty) {
      this.dirty = false;
      this.renderer.draw(
        this.sim,
        this.cam,
        { hover: this.hover, selected: this.selected, fade: easeOut(this.fade), labelZoom: this.fitK * 2 },
        this.settings
      );
      this.positionLabel();
    }
    if (moving) this.frame = requestAnimationFrame(() => this.tick());
  }

  private easeCamera(target: Camera2D): void {
    this.cam = {
      x: this.cam.x + (target.x - this.cam.x) * 0.08,
      y: this.cam.y + (target.y - this.cam.y) * 0.08,
      k: this.cam.k + (target.k - this.cam.k) * 0.08,
    };
  }

  // ============================================================
  // Interazione: pan, zoom (rotella / pinch), hover, selezione.
  // ============================================================
  private bindPointer(canvas: HTMLCanvasElement): void {
    const local = (e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      this.dragMoved = 0;
      if (this.pointers.size === 2) this.pinchDist = this.pointerSpread();
    });

    canvas.addEventListener("pointermove", (e) => {
      const p = local(e);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === "mouse") this.updateHover(p.x, p.y);
        return;
      }
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const d = this.pointerSpread();
        if (this.pinchDist > 0) this.zoomAt(this.pointerCenter(), d / this.pinchDist);
        this.pinchDist = d;
        this.dragMoved += 10;
        return;
      }
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.dragMoved > 4) {
        this.autoFit = false;
        this.cam = { ...this.cam, x: this.cam.x - dx / this.cam.k, y: this.cam.y - dy / this.cam.k };
        this.requestDraw();
      }
    });

    const end = (e: PointerEvent): void => {
      const wasTap = this.pointers.size === 1 && this.dragMoved <= 4;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (wasTap && this.sim && this.renderer) {
        const p = local(e);
        const hit = this.renderer.hitTest(this.sim, this.cam, p.x, p.y);
        this.selected = hit;
        this.updateSelectionUi();
        this.requestDraw();
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", (e) => this.pointers.delete(e.pointerId));
    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && this.hover !== null) {
        this.hover = null;
        this.requestDraw();
      }
    });

    canvas.addEventListener("dblclick", (e) => {
      if (!this.sim || !this.renderer) return;
      const p = local(e);
      const hit = this.renderer.hitTest(this.sim, this.cam, p.x, p.y);
      if (hit !== null) {
        this.selected = hit;
        this.openSelected();
      }
    });

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomAt(local(e), Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false }
    );
  }

  private pointerSpread(): number {
    const [a, b] = Array.from(this.pointers.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pointerCenter(): { x: number; y: number } {
    const [a, b] = Array.from(this.pointers.values());
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private zoomAt(screen: { x: number; y: number }, factor: number): void {
    if (!this.renderer) return;
    this.autoFit = false;
    const before = this.renderer.screenToWorld(this.cam, screen.x, screen.y);
    const k = Math.min(8, Math.max(0.15, this.cam.k * factor));
    this.cam = { ...this.cam, k };
    const after = this.renderer.screenToWorld(this.cam, screen.x, screen.y);
    this.cam = { x: this.cam.x + before.x - after.x, y: this.cam.y + before.y - after.y, k };
    this.requestDraw();
  }

  private updateHover(sx: number, sy: number): void {
    if (!this.sim || !this.renderer) return;
    const hit = this.renderer.hitTest(this.sim, this.cam, sx, sy);
    if (hit !== this.hover) {
      this.hover = hit;
      this.renderer.canvas.style.cursor = hit !== null ? "pointer" : "grab";
      this.requestDraw();
    }
  }

  private positionLabel(): void {
    if (!this.labelEl || !this.sim || !this.renderer) return;
    const i = this.hover ?? this.selected;
    if (i === null) {
      this.labelEl.removeClass("is-visible");
      return;
    }
    const n = this.sim.nodes[i];
    const f = this.files[i];
    const s = this.renderer.worldToScreen(this.cam, n.x, n.y);
    this.labelEl.empty();
    const title = this.app.metadataCache.getFileCache(f)?.frontmatter?.title;
    this.labelEl.createDiv({
      cls: "asb-gg-label-title",
      text: typeof title === "string" && title.trim() ? title : f.basename,
    });
    this.labelEl.createDiv({
      cls: "asb-gg-label-meta",
      text: `${AREA_LABELS[n.area] ?? n.area} · ${n.degree} collegamenti`,
    });
    this.labelEl.style.transform = `translate(${s.x}px, ${s.y - n.r * this.cam.k - 8}px) translate(-50%, -100%)`;
    this.labelEl.addClass("is-visible");
  }

  private updateSelectionUi(): void {
    if (this.selected !== null) this.openBtn?.removeClass("is-hidden");
    else this.openBtn?.addClass("is-hidden");
  }

  private openSelected(): void {
    if (this.selected === null) return;
    const f = this.files[this.selected];
    if (f) void this.app.workspace.getLeaf("tab").openFile(f);
  }

  // ============================================================
  // HUD — stesso stile del Galaxy 3D, chiuso di default.
  // ============================================================
  private buildHud(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "asb-gg-controls is-collapsed" });
    const toggle = panel.createEl("button", { cls: "asb-gg-toggle" });
    toggle.createSpan({ text: "Grafo" });
    const chev = toggle.createSpan({ cls: "asb-gg-chevron", text: "▸" });
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("is-collapsed") === false;
      chev.textContent = open ? "▾" : "▸";
    });
    const body = panel.createDiv({ cls: "asb-gg-body" });

    const inputs = new Map<keyof G2DSettings, HTMLInputElement>();
    const slider = (key: keyof G2DSettings, name: string): void => {
      const label = body.createEl("label");
      label.createSpan({ text: name });
      const input = label.createEl("input", { type: "range" });
      input.min = "0";
      input.max = "2";
      input.step = "0.05";
      input.value = String(this.settings[key]);
      inputs.set(key, input);
      input.addEventListener("input", () => {
        this.settings[key] = parseFloat(input.value);
        this.requestDraw();
        this.scheduleSave();
      });
    };
    slider("glow", "Glow");
    slider("halos", "Aloni");
    slider("links", "Link");
    slider("stars", "Stelle");

    const actions = body.createDiv({ cls: "asb-gg-actions" });
    const btn = (text: string, fn: () => void): void => {
      actions.createEl("button", { text }).addEventListener("click", fn);
    };
    btn("Reset", () => {
      this.settings = { ...DEFAULT_G2D };
      for (const [k, input] of inputs) input.value = String(this.settings[k]);
      this.requestDraw();
      this.scheduleSave();
    });
    btn("Centra", () => {
      if (!this.sim || !this.renderer) return;
      this.autoFit = true;
      this.cam = this.renderer.fitCamera(this.sim);
      this.fitK = this.cam.k;
      this.requestDraw();
    });
    btn("Re-layout", () => this.rebuild(false));
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveG2DSettings(this.settings);
    }, 400);
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
