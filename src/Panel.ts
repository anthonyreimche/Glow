// The Develop panel: Amount, Size and Threshold, then a one-line hint — core
// sliders only. Sliders write the bag live and commit on release with their
// own label.
//
// It edits whatever useParamScope hands it: the photo's bag in the dock, a
// mask's in the Masking panel's Adjust tab. Nothing here measures the photo,
// so a mask's panel has every slider.

import type { CSSProperties } from "react";
import { DEFAULT_PARAMS, type Params } from "./model";
import { RANGE, deriveAll, readParams } from "./params";
import { api, h } from "./runtime";

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  read(p: Params): number;
  write(p: Params, value: number): Params;
  commitLabel: string;
}

export const SLIDERS: readonly SliderSpec[] = [
  {
    label: "Amount",
    ...RANGE.amount,
    read: (p) => p.amount,
    write: (p, amount) => ({ ...p, amount }),
    commitLabel: "amount",
  },
  {
    label: "Size",
    ...RANGE.size,
    read: (p) => p.size,
    write: (p, size) => ({ ...p, size }),
    commitLabel: "size",
  },
  {
    label: "Threshold",
    ...RANGE.threshold,
    read: (p) => p.threshold,
    write: (p, threshold) => ({ ...p, threshold }),
    commitLabel: "threshold",
  },
];

export const HINT =
  "Pixels brighter than Threshold glow; Size is how far the glow reaches. Threshold 0 softens the whole photo.";

const COLUMN: CSSProperties = { display: "flex", flexDirection: "column", gap: 1 };

export function GlowPanel() {
  const { Slider } = api().components;
  const { Stack, tokens } = api().ui;
  const scope = api().develop.useParamScope();
  const p = readParams(scope.getParams());

  const live = (): Params => readParams(scope.getParams());
  const apply = (next: Params) => scope.setParams(deriveAll(next));
  const commit = (what: string) => scope.commit(`Glow ${what}`);

  const slider = (spec: SliderSpec) =>
    h(Slider, {
      key: spec.label,
      label: spec.label,
      value: spec.read(p),
      min: spec.min,
      max: spec.max,
      step: spec.step,
      defaultValue: spec.read(DEFAULT_PARAMS),
      onChange: (v: number) => apply(spec.write(live(), v)),
      onCommit: () => commit(spec.commitLabel),
    });

  const hintStyle: CSSProperties = { margin: 0, fontSize: 10, lineHeight: 1.4, color: tokens.textMuted };

  return h(
    Stack,
    { gap: 6, style: { padding: "6px 8px 8px" } },
    h("div", { key: "controls", style: COLUMN }, ...SLIDERS.map(slider)),
    h("p", { key: "hint", style: hintStyle }, HINT),
  );
}
