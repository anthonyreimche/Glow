// The stage: one scene-linear stage on the host's stage/prepass framework
// that reads the current image. One pass, as many draws as Size needs (the
// bag's `draws`, at most MAX_DRAWS), 26 fetches per pixel per draw; the host
// caches the result until a pass key, the source or anything upstream
// changes, so dragging Amount is a cache hit.

import { HELPERS_GLSL, INLINE_GLSL, PASS_GLSL } from "./glsl";
import { DEFAULT_PARAMS, MAX_DRAWS } from "./model";
import { RANGE, STAGE_ID } from "./params";
import type { ProcessingStageContribution, StagePass } from "./safelight";

export function glowPass(): StagePass {
  return {
    glsl: PASS_GLSL,
    helpers: HELPERS_GLSL,
    iterations: { key: "draws", max: MAX_DRAWS },
    uniforms: [
      { key: "size", glslType: "float", default: DEFAULT_PARAMS.size, range: { ...RANGE.size }, label: "size" },
      {
        key: "threshold",
        glslType: "float",
        default: DEFAULT_PARAMS.threshold,
        range: { ...RANGE.threshold },
        label: "threshold",
      },
    ],
  };
}

export function glowStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "Glow",
    // Light scatters before the tone curve; after local contrast (60), before
    // the colour ports (80–85).
    phase: "scene-linear",
    priority: 70,
    reads: "current",
    glsl: INLINE_GLSL,
    uniforms: [
      { key: "amount", glslType: "float", default: 0, range: { ...RANGE.amount }, label: "amount" },
      { key: "draws", glslType: "float", default: 0, range: { min: 0, max: MAX_DRAWS, step: 1 } },
    ],
    passes: [glowPass()],
    presetScope: "global",
    // A mask's copy runs its own chain with the mask's values; its draw count
    // is zero until its Amount moves, so an untouched mask is skipped like the photo.
    mask: { maskable: true },
  };
}

export function allStages(): ProcessingStageContribution[] {
  return [glowStage()];
}
