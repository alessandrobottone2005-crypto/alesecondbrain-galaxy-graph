import { Plugin, WorkspaceLeaf } from "obsidian";
import { GalaxyGraphView, VIEW_TYPE_GALAXY } from "./view";
import { Graph2DView, VIEW_TYPE_GRAPH_2D } from "./view2d";
import type { GalaxySettings } from "./galaxy";
import type { G2DSettings } from "./render2d";

// data.json: impostazioni 3D alla radice (compatibilità), Galaxy 2D sotto "g2d".
type PluginData = Partial<GalaxySettings> & { g2d?: Partial<G2DSettings> };

export default class AleSecondBrainGalaxyGraphPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_GALAXY, (leaf) => new GalaxyGraphView(leaf, this));
    this.registerView(VIEW_TYPE_GRAPH_2D, (leaf) => new Graph2DView(leaf, this));

    this.addRibbonIcon("network", "Open AleSecondBrain Graph", () => {
      void this.activateView(VIEW_TYPE_GRAPH_2D);
    });

    this.addCommand({
      id: "open-alesecondbrain-graph-2d",
      name: "Open AleSecondBrain Graph (2D)",
      callback: () => {
        void this.activateView(VIEW_TYPE_GRAPH_2D);
      },
    });

    this.addCommand({
      id: "open-alesecondbrain-galaxy-graph",
      name: "Open AleSecondBrain Galaxy Graph (3D)",
      callback: () => {
        void this.activateView(VIEW_TYPE_GALAXY);
      },
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GALAXY);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GRAPH_2D);
  }

  async activateView(type: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(type);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async readData(): Promise<PluginData> {
    const data = await this.loadData();
    return data && typeof data === "object" ? (data as PluginData) : {};
  }

  async loadSettings(): Promise<Partial<GalaxySettings>> {
    const { g2d: _g2d, ...rest } = await this.readData();
    return rest;
  }

  async saveSettings(settings: GalaxySettings): Promise<void> {
    const data = await this.readData();
    await this.saveData({ ...settings, g2d: data.g2d });
  }

  async loadG2DSettings(): Promise<Partial<G2DSettings>> {
    return (await this.readData()).g2d ?? {};
  }

  async saveG2DSettings(settings: G2DSettings): Promise<void> {
    const data = await this.readData();
    await this.saveData({ ...data, g2d: settings });
  }
}
