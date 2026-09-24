import { ItemView, type TFile, WorkspaceLeaf } from "obsidian";
import { buildGraph, type GalaxyGraph } from "./layout";
import {
  DEFAULT_SETTINGS,
  GalaxyScene,
  type CameraState,
  type GalaxySettings,
} from "./galaxy";

export const VIEW_TYPE_GALAXY = "alesecondbrain-galaxy-graph-view";

type SettingKey = keyof GalaxySettings;

interface SettingsHost {
  loadSettings(): Promise<Partial<GalaxySettings>>;
  saveSettings(settings: GalaxySettings): Promise<void>;
}

export class GalaxyGraphView extends ItemView {
  private scene: GalaxyScene | null = null;
  private graph: GalaxyGraph | null = null;
  private settings: GalaxySettings = { ...DEFAULT_SETTINGS };
  private labelEl: HTMLElement | null = null;
  private viewHost: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private openBtn: HTMLElement | null = null;
  private selectedFile: TFile | null = null;
  private sliders = new Map<SettingKey, HTMLInputElement>();
  private saveTimer: number | null = null;
  private rebuildTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: SettingsHost) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_GALAXY;
  }

  getDisplayText(): string {
    return "AleSecondBrain Galaxy Graph";
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.classList.add("alesecondbrain-galaxy-graph");

    this.settings = { ...DEFAULT_SETTINGS, ...(await this.plugin.loadSettings()) };

    this.labelEl = container.createDiv({ cls: "asb-gg-label" });
    this.viewHost = container.createDiv({ cls: "asb-gg-host" });
    this.openBtn = container.createEl("button", { cls: "asb-gg-open is-hidden", text: "Open note" });
    this.openBtn.addEventListener("click", () => {
      if (this.selectedFile) void this.app.workspace.getLeaf("tab").openFile(this.selectedFile);
    });

    this.buildHud(container);
    this.buildScene();

    // Live vault update — debounce ~900ms, solo note .md (niente data.json).
    const scheduleIfMd = (path: string): void => {
      if (path.endsWith(".md")) this.scheduleRebuild();
    };
    this.registerEvent(this.app.vault.on("create", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f) => scheduleIfMd(f.path)));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRebuild()));
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildScene();
    }, 900);
  }

  async onClose(): Promise<void> {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.scene?.dispose();
    this.scene = null;
    this.graph = null;
  }

  // ============================================================
  // HUD — collassabile, 6 slider, Reset / Re-layout / Refresh.
  // ============================================================
  private buildHud(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "asb-gg-controls is-collapsed" });

    const toggle = panel.createEl("button", { cls: "asb-gg-toggle" });
    toggle.createSpan({ text: "Galaxy" });
    const chev = toggle.createSpan({ cls: "asb-gg-chevron", text: "▸" });
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("is-collapsed") === false;
      chev.textContent = open ? "▾" : "▸";
    });

    const body = panel.createDiv({ cls: "asb-gg-body" });

    const makeSlider = (
      key: SettingKey,
      name: string,
      min: string,
      max: string,
      step: string
    ): void => {
      const label = body.createEl("label");
      label.createSpan({ text: name });
      const input = label.createEl("input", { type: "range" });
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = String(this.settings[key]);
      this.sliders.set(key, input);
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        this.applySetting(key, v);
      });
    };

    makeSlider("bloom", "Bloom", "0", "2", "0.05");
    makeSlider("spread", "Spread", "0.6", "1.8", "0.05");
    makeSlider("linkOpacity", "Links", "0.02", "0.4", "0.002");
    makeSlider("fog", "Fog", "0", "0.006", "0.0002");
    makeSlider("nebula", "Nebula", "0", "1.5", "0.05");
    makeSlider("stars", "Stars", "0", "1.5", "0.05");

    const actions = body.createDiv({ cls: "asb-gg-actions" });
    const mkBtn = (text: string, fn: () => void): void => {
      const b = actions.createEl("button", { text });
      b.addEventListener("click", fn);
    };
    mkBtn("Reset", () => {
      this.settings = { ...DEFAULT_SETTINGS };
      for (const [k, input] of this.sliders) input.value = String(this.settings[k]);
      this.scene?.setBloom(this.settings.bloom);
      this.scene?.setSpread(this.settings.spread);
      this.scene?.setLinkOpacity(this.settings.linkOpacity);
      this.scene?.setFog(this.settings.fog);
      this.scene?.setNebula(this.settings.nebula);
      this.scene?.setStars(this.settings.stars);
      this.scheduleSave();
    });
    mkBtn("Re-layout", () => this.rebuildScene());
    mkBtn("Refresh", () => this.rebuildScene());
  }

  private applySetting(key: SettingKey, value: number): void {
    this.settings[key] = value;
    if (!this.scene) return;
    switch (key) {
      case "bloom":
        this.scene.setBloom(value);
        break;
      case "spread":
        this.scene.setSpread(value);
        break;
      case "linkOpacity":
        this.scene.setLinkOpacity(value);
        break;
      case "fog":
        this.scene.setFog(value);
        break;
      case "nebula":
        this.scene.setNebula(value);
        break;
      case "stars":
        this.scene.setStars(value);
        break;
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveSettings(this.settings);
    }, 400);
  }

  // ============================================================
  // SCENE LIFECYCLE — rebuild preservando la camera.
  // ============================================================
  private buildScene(savedCamera?: CameraState): void {
    if (!this.viewHost || !this.labelEl) return;
    this.scene?.dispose();
    this.scene = null;
    this.selectedFile = null;
    this.openBtn?.addClass("is-hidden");

    try {
      this.graph = buildGraph(this.app);
    } catch (err) {
      console.error("AleSecondBrain Galaxy Graph: buildGraph failed", err);
      this.graph = { nodes: [], links: [], nodeById: new Map(), maxDegree: 1, macro: emptyMacro() };
    }

    this.updateHint();

    try {
      this.scene = new GalaxyScene(this.viewHost, this.graph, {
        labelEl: this.labelEl,
        onOpenFile: (file) => {
          void this.app.workspace.getLeaf("tab").openFile(file);
        },
        onSelectionChange: (file) => {
          this.selectedFile = file;
          if (file) this.openBtn?.removeClass("is-hidden");
          else this.openBtn?.addClass("is-hidden");
        },
        settings: this.settings,
        savedCamera,
      });
    } catch (err) {
      console.error("AleSecondBrain Galaxy Graph: WebGL init failed", err);
      this.showWebGLError();
    }
  }

  private rebuildScene(): void {
    const saved = this.scene?.getCameraState();
    this.buildScene(saved);
  }

  private updateHint(): void {
    this.hintEl?.remove();
    this.hintEl = null;
    if (this.graph && this.graph.nodes.length === 0 && this.viewHost) {
      this.hintEl = this.viewHost.createDiv({ cls: "asb-gg-hint" });
      this.hintEl.setText("Nessuna nota nel Vault");
    }
  }

  private showWebGLError(): void {
    if (!this.viewHost) return;
    const box = this.viewHost.createDiv({ cls: "asb-gg-error" });
    box.setText("WebGL non disponibile — il Galaxy Graph non può essere visualizzato.");
  }
}

function emptyMacro(): GalaxyGraph["macro"] {
  return {
    areas: [],
    pairs: [],
    pairWeight: new Map(),
    crossLinks: new Map(),
    noteCount: new Map(),
    tier: new Map(),
  };
}
