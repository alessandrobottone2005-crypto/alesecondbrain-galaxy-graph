import { Plugin, WorkspaceLeaf } from "obsidian";
import { GalaxyGraphView, VIEW_TYPE_GALAXY } from "./view";
import type { GalaxySettings } from "./galaxy";

export default class AleSecondBrainGalaxyGraphPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_GALAXY, (leaf) => new GalaxyGraphView(leaf, this));

    this.addRibbonIcon("network", "Open AleSecondBrain Galaxy Graph", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-alesecondbrain-galaxy-graph",
      name: "Open AleSecondBrain Galaxy Graph",
      callback: () => {
        void this.activateView();
      },
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_GALAXY);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALAXY);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_GALAXY, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<Partial<GalaxySettings>> {
    const data = await this.loadData();
    return data && typeof data === "object" ? (data as Partial<GalaxySettings>) : {};
  }

  async saveSettings(settings: GalaxySettings): Promise<void> {
    await this.saveData(settings);
  }
}
