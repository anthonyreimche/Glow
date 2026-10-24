// Activation contract against a stand-in API: what activate() registers under
// the extension id, that a bag whose draw count disagrees with its controls
// is re-derived live, and that deactivate() tears everything down. No React
// render — the component is exercised in the app.

import { afterEach, describe, expect, it } from "vitest";
import { activate, deactivate } from "../src/index";
import { DEFAULT_PARAMS } from "../src/model";
import { GlowPanel } from "../src/Panel";
import { KEY, STAGE_ID, deriveAll } from "../src/params";
import type { DevelopStoreState, PanelContribution, ProcessingStageContribution, SafelightAPI } from "../src/safelight";
import { fakeStore } from "./support/fake-store";

interface Registered {
  stages: ProcessingStageContribution[];
  panels: PanelContribution[];
  unregisteredStages: string[];
  patches: Record<string, unknown>[];
  commits: string[];
}

function fakeApi() {
  const registered: Registered = { stages: [], panels: [], unregisteredStages: [], patches: [], commits: [] };
  const develop = fakeStore<DevelopStoreState>({
    photoId: null,
    paramBag: {},
    setDynParams: (patch) => {
      registered.patches.push(patch);
      develop.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } }));
    },
    commitEdit: async (label) => void registered.commits.push(label),
  });
  const api = {
    version: 1,
    extensionId: "glow",
    registerProcessingStage: (c: ProcessingStageContribution) => void registered.stages.push(c),
    unregisterProcessingStage: (id: string) => void registered.unregisteredStages.push(id),
    registerPanel: (c: PanelContribution) => void registered.panels.push(c),
    stores: { useDevelopStore: develop },
  } as unknown as SafelightAPI;
  return { api, registered, develop };
}

const EDITED = { amount: 40, size: 55, threshold: 60 };

describe("activate", () => {
  afterEach(() => deactivate());

  it("registers the stage and the panel", () => {
    const { api, registered } = fakeApi();
    activate(api);
    expect(registered.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(registered.panels.map((p) => p.id)).toEqual(["glow.panel"]);
    expect(registered.panels[0].title).toBe("Glow");
    expect(registered.panels[0].component).toBe(GlowPanel);
    expect(registered.panels[0].defaultDock).toEqual({ module: "develop", direction: "right", order: 8, width: 268 });
    expect(typeof registered.panels[0].onReset).toBe("function");
  });

  it("offers the panel in masks, owning every key it writes", () => {
    const { api, registered } = fakeApi();
    activate(api);
    expect(registered.panels[0].mask?.component).toBe(GlowPanel);
    expect([...(registered.panels[0].mask?.owns ?? [])].sort()).toEqual(Object.keys(deriveAll(DEFAULT_PARAMS)).sort());
  });

  it("resets the photo's glow to the defaults from the dock header, in one commit", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    develop.setState({ paramBag: deriveAll(EDITED) });
    registered.panels[0].onReset?.();
    expect(develop.getState().paramBag).toEqual(deriveAll(DEFAULT_PARAMS));
    expect(registered.commits).toEqual(["Glow reset"]);
  });

  it("re-derives the draw count when a loaded bag disagrees with its controls", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    develop.setState({ paramBag: { ...deriveAll(EDITED), [KEY.draws]: 0 } });
    expect(registered.patches).toEqual([deriveAll(EDITED)]);
    develop.setState({ paramBag: deriveAll(EDITED) });
    expect(registered.patches.length).toBe(1);
  });

  it("drops the stage and stops listening on deactivate", () => {
    const { api, registered, develop } = fakeApi();
    activate(api);
    deactivate();
    expect(registered.unregisteredStages).toEqual([STAGE_ID]);
    develop.setState({ paramBag: { ...deriveAll(EDITED), [KEY.draws]: 0 } });
    expect(registered.patches.length).toBe(0);
  });
});
