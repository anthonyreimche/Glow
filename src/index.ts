// Glow — Safelight extension (MIT).
//
// Highlights bloom into their surroundings in linear light: the pixels above
// a luminance threshold, in their own colour, blurred to a size and added
// back at an amount. Registers one scene-linear GPU stage (stage.ts) and the
// Develop panel (Panel.ts).

import { GlowPanel } from "./Panel";
import { EXT_ID, allKeys, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./runtime";
import type { DevelopStoreState, SafelightAPI } from "./safelight";
import { allStages } from "./stage";

const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api().stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit("Glow reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);

  // An untouched photo's bag has no keys and a reset one derives no draws, so
  // neither runs the prepass, and the inline's gate keeps it bit-exact.
  for (const stage of allStages()) host.registerProcessingStage(stage);

  host.registerPanel({
    id: PANEL_ID,
    title: "Glow",
    component: GlowPanel,
    defaultDock: { module: "develop", direction: "right", order: 8, width: 268 },
    onReset: reset,
    // The same panel edits a mask's glow in the Masking panel's Adjust tab.
    mask: { component: GlowPanel, owns: allKeys() },
  });

  // A bag whose draw count disagrees with its controls (a preset that carried
  // only Amount, an edit from another release) is re-derived live; the edit
  // itself is rewritten by the next commit, as any other change would be.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopStoreState, prev: DevelopStoreState) => {
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
  // The host sweeps this extension's registrations on disable or uninstall;
  // dropping the stage explicitly keeps a re-enable clean.
  try {
    const host = api();
    for (const stage of allStages()) host.unregisterProcessingStage(stage.id);
  } catch {
    /* activate() never ran — nothing to tear down */
  }
}
