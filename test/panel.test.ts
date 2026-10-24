// The panel's layout as data — the slider table is what the component
// renders, so pinning it pins the panel without a React render — then the
// component itself, built without React, editing the photo's bag in the dock
// and a mask's in the Masking panel's Adjust tab.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/model";
import { GlowPanel, HINT, SLIDERS } from "../src/Panel";
import { KEY, deriveAll, readParams } from "../src/params";
import { initRuntime } from "../src/runtime";
import type { DevelopStoreState, ParamScope, SafelightAPI, SliderProps } from "../src/safelight";
import { fakeStore } from "./support/fake-store";

describe("slider table", () => {
  it("lists Amount, Size and Threshold on their ranges with their defaults", () => {
    expect(SLIDERS.map((s) => [s.label, s.min, s.max, s.step, s.read(DEFAULT_PARAMS), s.commitLabel])).toEqual([
      ["Amount", 0, 100, 1, 0, "amount"],
      ["Size", 0, 100, 1, 30, "size"],
      ["Threshold", 0, 100, 1, 80, "threshold"],
    ]);
    expect(SLIDERS[0].write(DEFAULT_PARAMS, 35)).toEqual({ ...DEFAULT_PARAMS, amount: 35 });
    expect(SLIDERS[1].write(DEFAULT_PARAMS, 70)).toEqual({ ...DEFAULT_PARAMS, size: 70 });
    expect(SLIDERS[2].write(DEFAULT_PARAMS, 15)).toEqual({ ...DEFAULT_PARAMS, threshold: 15 });
  });

  it("explains the controls in one line", () => {
    expect(HINT).toBe(
      "Pixels brighter than Threshold glow; Size is how far the glow reaches. Threshold 0 softens the whole photo.",
    );
  });
});

interface Element {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
}

const Slider = () => null;
const Stack = () => null;

function sliderProps(node: unknown): SliderProps[] {
  if (!node || typeof node !== "object") return [];
  const el = node as Element;
  const own = el.type === Slider ? [el.props as unknown as SliderProps] : [];
  return [...own, ...el.children.flatMap(sliderProps)];
}

/** The panel over a photo bag, inside a mask holding `maskBag` when one is
 *  given; `sliders()` renders it again and hands back each Slider's props. */
function panelRig(photoBag: Record<string, unknown> = {}, maskBag?: Record<string, unknown>) {
  const commits: string[] = [];
  const photo = fakeStore<DevelopStoreState>({
    photoId: "p1",
    paramBag: photoBag,
    setDynParams: (patch) => photo.setState((s) => ({ paramBag: { ...s.paramBag, ...patch } })),
    commitEdit: async (label) => void commits.push(label),
  });
  const mask = fakeStore({ bag: maskBag ?? {} });
  const photoScope: ParamScope = {
    maskId: null,
    getParam: (key) => photo.getState().paramBag[key],
    getParams: () => photo.getState().paramBag,
    setParams: (patch) => photo.getState().setDynParams(patch),
    commit: (label) => void photo.getState().commitEdit(label),
  };
  const maskScope: ParamScope = {
    maskId: "mask-1",
    getParam: (key) => mask.getState().bag[key],
    getParams: () => mask.getState().bag,
    setParams: (patch) => mask.setState((s) => ({ bag: { ...s.bag, ...patch } })),
    commit: (label) => void commits.push(`mask: ${label}`),
  };
  const createElement = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({
    type,
    props: props ?? {},
    children,
  });
  initRuntime({
    react: { createElement },
    components: { Slider },
    ui: { Stack, tokens: { textMuted: "grey" } },
    stores: { useDevelopStore: photo },
    develop: { useParamScope: () => (maskBag === undefined ? photoScope : maskScope) },
  } as unknown as SafelightAPI);
  const sliders = () => sliderProps(GlowPanel());
  const slider = (label: string) => sliders().find((s) => s.label === label)!;
  return { photo, mask, commits, sliders, slider };
}

describe("GlowPanel in the dock", () => {
  it("shows the defaults over an empty bag, each slider resetting to its default", () => {
    const rig = panelRig();
    expect(rig.sliders().map((s) => [s.label, s.value, s.defaultValue])).toEqual([
      ["Amount", 0, 0],
      ["Size", 30, 30],
      ["Threshold", 80, 80],
    ]);
  });

  it("writes a slider to the photo's bag with its draw count and commits under its label", () => {
    const rig = panelRig();
    const amount = rig.slider("Amount");
    amount.onChange(35);
    amount.onCommit?.();
    expect(rig.photo.getState().paramBag).toEqual(deriveAll({ ...DEFAULT_PARAMS, amount: 35 }));
    expect(rig.photo.getState().paramBag[KEY.draws]).toBe(8);
    expect(rig.commits).toEqual(["Glow amount"]);
  });

  it("keeps the stage idle while Amount stays at zero", () => {
    const rig = panelRig();
    rig.slider("Size").onChange(90);
    expect(rig.photo.getState().paramBag[KEY.draws]).toBe(0);
  });
});

// Nothing in the panel measures or picks from the photo, so a mask's has
// every slider the dock's has.
describe("GlowPanel in a mask", () => {
  it("shows the mask's values, not the photo's, on every slider the dock has", () => {
    const rig = panelRig(deriveAll({ amount: 20, size: 10, threshold: 90 }), deriveAll({ amount: 60, size: 50, threshold: 40 }));
    expect(rig.sliders().map((s) => s.label)).toEqual(SLIDERS.map((s) => s.label));
    expect(rig.slider("Amount").value).toBe(60);
    expect(rig.slider("Size").value).toBe(50);
    expect(rig.slider("Threshold").value).toBe(40);
  });

  it("writes a slider to the mask with its draw count, leaves the photo's bag alone, and commits once", () => {
    const rig = panelRig({}, {});
    const amount = rig.slider("Amount");
    amount.onChange(35);
    amount.onCommit?.();
    expect(rig.mask.getState().bag).toEqual(deriveAll({ ...DEFAULT_PARAMS, amount: 35 }));
    expect(rig.photo.getState().paramBag).toEqual({});
    expect(rig.commits).toEqual(["mask: Glow amount"]);
  });

  it("starts each change from the mask's values as they are now, not the render's", () => {
    const rig = panelRig({}, {});
    const sliders = rig.sliders();
    sliders.find((s) => s.label === "Amount")!.onChange(35);
    sliders.find((s) => s.label === "Size")!.onChange(70);
    expect(readParams(rig.mask.getState().bag)).toEqual({ amount: 35, size: 70, threshold: 80 });
  });
});
