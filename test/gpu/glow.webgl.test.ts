// The stage on the real renderer. Run via `npm run test:gpu` (test/gpu/run.cjs
// copies this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//
//  • the pass program and the inline compile and link on a real GLSL ES 3.00
//    driver, with the host's uniform and helper namespacing and the split
//    draw a reads-current stage gets;
//  • Amount 0 is a bit-exact no-op through the host's gate, also with Size
//    and Threshold set (the bag then derives no draws and the stage is idle);
//  • the bag-driven draw count runs the cascade on half-float targets, with
//    bilinear taps at the sub-texel steps a 256-px frame gets, and matches
//    the CPU model for several parameter sets;
//  • a 96×64 frame matches the model at its own anchoring;
//  • the glow follows exposure, since the stage reads the current image;
//  • a mask's copy of the stage runs its own glow inside the mask, leaving
//    every pixel outside it as the photo's own settings left it.
//
// The timings it prints are SwiftShader (CPU) numbers, only useful relative
// to each other.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, applyGlow, type Image, type Params } from "@glow/model";
import { deriveAll } from "@glow/params";
import { allStages } from "@glow/stage";
import { fill, type Rgb } from "@glow-test/support/scenes";
import { defaultMaskAdjustments, type Mask } from "@/catalog/types";
import {
  LINEAR_PROBE_PIPELINE,
  type Frame,
  builtinStages,
  floatImage,
  identityParams,
  withRenderer,
} from "@/rendering/webgl/webgl.test-support";

// ── Scenes ───────────────────────────────────────────────────────────────────

/** A darker field with a gentle gradient, three grey discs and one coloured
 *  disc well above the thresholds in use, a bright bar, and a soft bump that
 *  crosses the threshold. Peaks stay at 0.5 so the glow keeps every output
 *  under the probe pipeline's knee. */
function scene(w: number, h: number): Image {
  const discs: [number, number, number, Rgb][] = [
    [0.22 * w, 0.3 * h, 0.05 * w, [0.5, 0.5, 0.5]],
    [0.7 * w, 0.25 * h, 0.03 * w, [0.5, 0.5, 0.5]],
    [0.5 * w, 0.72 * h, 0.07 * w, [0.5, 0.5, 0.5]],
    [0.82 * w, 0.68 * h, 0.04 * w, [0.5, 0.3, 0.2]],
  ];
  return fill(w, h, (x, y) => {
    for (const [cx, cy, r, v] of discs) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return v;
    if (y > 0.88 * h && y < 0.92 * h && x > 0.1 * w && x < 0.6 * w) return [0.45, 0.45, 0.5];
    const bump = 0.3 * Math.exp(-(((x - 0.3 * w) ** 2 + (y - 0.55 * h) ** 2) / (2 * (0.04 * w) ** 2)));
    const field = 0.06 + 0.06 * (x / w);
    return [field + bump, field + bump * 0.9, field + bump * 0.8];
  });
}

const toFloatImage = (img: Image) =>
  floatImage(img.width, img.height, (x, y) => {
    const i = (y * img.width + x) * 3;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  });

/** float32 → binary16 → float32, round to nearest even: the source upload is
 *  RGBA16F, so this is the value the GPU actually receives. */
function f16round(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  const e = Math.floor(Math.log2(a));
  const stepSize = Math.pow(2, Math.max(e, -14) - 10);
  const q = a / stepSize;
  const f = Math.floor(q);
  const frac = q - f;
  const r = frac > 0.5 || (frac === 0.5 && f % 2 === 1) ? f + 1 : f;
  return sign * r * stepSize;
}

// ── Reference and comparison ─────────────────────────────────────────────────

/** The model on the half-float source, scaled by `gain` first (exposure). */
function reference(img: Image, p: Params, gain = 1): { input: Float64Array; output: Float64Array } {
  const input = img.data.map((v) => f16round(v) * gain);
  const output = applyGlow({ ...img, data: input }, p);
  return { input, output };
}

interface Comparison {
  rmse: number;
  changeRms: number;
  max: number;
  clipped: number;
  outliers: number;
  worst: string;
}

// Beyond these the probe pipeline's knee and clamp make a sample incomparable.
const CLIP_LO = 0.002;
const CLIP_HI = 0.8;

/** The GPU's change against the model's, over the columns `inside` picks (all by default). */
function compare(
  on: Frame,
  off: Frame,
  ref: { input: Float64Array; output: Float64Array },
  w: number,
  inside = (_x: number) => true,
): Comparison {
  let n = 0;
  let se = 0;
  let change = 0;
  let count = 0;
  let clipped = 0;
  let max = 0;
  let outliers = 0;
  let worst = "";
  for (let p = 0; p < on.width * on.height; p++) {
    if (!inside(p % w)) continue;
    n++;
    const out = [ref.output[p * 3], ref.output[p * 3 + 1], ref.output[p * 3 + 2]];
    if (out.some((v) => v < CLIP_LO || v > CLIP_HI)) {
      clipped++;
      continue;
    }
    for (let ch = 0; ch < 3; ch++) {
      const g = on.data[p * 4 + ch] - off.data[p * 4 + ch];
      const r = out[ch] - ref.input[p * 3 + ch];
      const e = g - r;
      se += e * e;
      change += r * r;
      count++;
      if (Math.abs(e) > 0.01) outliers++;
      if (Math.abs(e) > max) {
        max = Math.abs(e);
        worst = `x=${p % w} y=${Math.floor(p / w)} ch=${ch} in=${ref.input[p * 3 + ch].toFixed(4)} ref=${out[ch].toFixed(4)} gpu=${on.data[p * 4 + ch].toFixed(4)} off=${off.data[p * 4 + ch].toFixed(4)}`;
      }
    }
  }
  return {
    rmse: Math.sqrt(se / Math.max(1, count)),
    changeRms: Math.sqrt(change / Math.max(1, count)),
    max,
    clipped: clipped / n,
    outliers,
    worst,
  };
}

function expectBitExact(a: Frame | null, b: Frame | null): void {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  for (let i = 0; i < a!.data.length; i++) expect(a!.data[i]).toBe(b!.data[i]);
}

function expectMatch(name: string, s: Comparison, ms?: number): void {
  console.log(
    `[glow-gpu] ${name}: ${ms === undefined ? "" : `${ms.toFixed(0)} ms; `}model change rms ${s.changeRms.toExponential(2)}; ` +
      `error rms ${s.rmse.toExponential(2)} (${((100 * s.rmse) / s.changeRms).toFixed(2)}%), ` +
      `max ${s.max.toExponential(2)}, ${s.outliers} outliers, ${(100 * s.clipped).toFixed(2)}% clipped; worst ${s.worst}`,
  );
  expect(s.changeRms).toBeGreaterThan(1e-3);
  expect(s.clipped).toBeLessThan(0.1);
  expect(s.outliers).toBe(0);
  expect(s.rmse).toBeLessThan(Math.max(s.changeRms * MAX_ERROR_FRACTION, MAX_ERROR_FLOOR));
}

const MAX_ERROR_FRACTION = 0.02;
const MAX_ERROR_FLOOR = 1e-4;

const CURRENT = { processVersion: 2 } as const;

const HIGHLIGHTS: Params = { amount: 60, size: 30, threshold: 50 };

// A linear gradient whose step sits at u = 0.5: the right half is covered.
const RIGHT_HALF: Mask["components"][number] = {
  id: "right",
  kind: "linear",
  mode: "add",
  invert: false,
  linear: { x0: 0.5, y0: 0, x1: 0.5001, y1: 0 },
};

const CASES: [string, Params][] = [
  ["highlights, default size", HIGHLIGHTS],
  ["wide", { amount: 40, size: 80, threshold: 50 }],
  ["tight", { amount: 80, size: 5, threshold: 60 }],
  ["everything softens", { amount: 30, size: 30, threshold: 0 }],
  ["only the brightest", { amount: 100, size: 30, threshold: 70 }],
];

describe("Glow stage on the real renderer", () => {
  const W = 256;
  const H = 256;
  const SCENE = scene(W, H);
  const SCENE_IMAGE = toFloatImage(SCENE);

  it("is a bit-exact no-op at Amount 0, also with Size and Threshold set", () => {
    // Renderers share one context and a nested one's dispose() tears down GL
    // state the outer one relies on, so the frames are taken in sequence.
    const bare = withRenderer({ stages: builtinStages(), pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
      r.setImage(SCENE_IMAGE);
      r.setParams(identityParams(CURRENT));
      return r.captureFloatFrame();
    });
    const idle = withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (r) => {
      r.setImage(SCENE_IMAGE);
      r.setParams(identityParams(CURRENT));
      r.setContributedParams({});
      const empty = r.captureFloatFrame();
      r.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = r.captureFloatFrame();
      r.setContributedParams(deriveAll({ amount: 0, size: 90, threshold: 10 }));
      const options = r.captureFloatFrame();
      return { empty, off, options };
    });
    expectBitExact(idle.empty, bare);
    expectBitExact(idle.off, bare);
    expectBitExact(idle.options, bare);
  });

  it("matches the model for every parameter set", () => {
    withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SCENE_IMAGE);
      renderer.setParams(identityParams(CURRENT));
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = renderer.captureFloatFrame();
      expect(off).not.toBeNull();
      expect(off!.width).toBe(W);
      expect(off!.height).toBe(H);
      for (const [name, p] of CASES) {
        renderer.setContributedParams(deriveAll(p));
        const t0 = performance.now();
        const on = renderer.captureFloatFrame();
        const ms = performance.now() - t0;
        expect(on).not.toBeNull();
        expectMatch(name, compare(on!, off!, reference(SCENE, p), W), ms);
      }
    });
  });

  it("matches the model at a small frame's own anchoring", () => {
    const w = 96;
    const h = 64;
    const small = scene(w, h);
    const image = toFloatImage(small);
    const frames = withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(image);
      renderer.setParams(identityParams(CURRENT));
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = renderer.captureFloatFrame();
      renderer.setContributedParams(deriveAll(HIGHLIGHTS));
      const on = renderer.captureFloatFrame();
      return { off, on };
    });
    expect(frames.off).not.toBeNull();
    expect(frames.on).not.toBeNull();
    expectMatch(`${w}x${h}`, compare(frames.on!, frames.off!, reference(small, HIGHLIGHTS), w));
  });

  // The stage reads the current image, so a brighter exposure glows more: the
  // model on the scene at +1 EV is what the GPU renders at exposure +1.
  it("follows exposure", () => {
    const dim = fill(W, H, (x, y) => {
      const [r, g, b] = [SCENE.data[(y * W + x) * 3], SCENE.data[(y * W + x) * 3 + 1], SCENE.data[(y * W + x) * 3 + 2]];
      return [r * 0.5, g * 0.5, b * 0.5];
    });
    const p: Params = { amount: 40, size: 30, threshold: 50 };
    const frames = withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(toFloatImage(dim));
      renderer.setParams(identityParams({ ...CURRENT, exposure: 1 }));
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      const off = renderer.captureFloatFrame();
      renderer.setContributedParams(deriveAll(p));
      const on = renderer.captureFloatFrame();
      return { off, on };
    });
    expect(frames.off).not.toBeNull();
    expect(frames.on).not.toBeNull();
    // At +1 EV the half-float scene doubles exactly, so the model runs on the
    // doubled source.
    expectMatch("exposure +1 EV", compare(frames.on!, frames.off!, reference(dim, p, 2), W));
    // And a model that ignored exposure (the dim scene as uploaded) would not fit.
    const unexposed = compare(frames.on!, frames.off!, reference(dim, p, 1), W);
    expect(unexposed.rmse).toBeGreaterThan(unexposed.changeRms * 0.2);
  });

  it("applies a mask's glow inside the mask, and the photo's everywhere else", () => {
    const [name, params] = CASES[1];
    const mask: Mask = {
      id: "m",
      name: "Mask",
      visible: true,
      invert: false,
      opacity: 100,
      adj: defaultMaskAdjustments(),
      panels: ["glow.panel"],
      bag: deriveAll(params),
      components: [RIGHT_HALF],
    };
    withRenderer({ stages: [...builtinStages(), ...allStages()], pipeline: LINEAR_PROBE_PIPELINE }, (renderer) => {
      renderer.setImage(SCENE_IMAGE);
      renderer.setContributedParams(deriveAll(DEFAULT_PARAMS));
      renderer.setParams(identityParams(CURRENT));
      const off = renderer.captureFloatFrame();
      renderer.setParams(identityParams({ ...CURRENT, masks: [mask] }));
      const on = renderer.captureFloatFrame();
      expect(off).not.toBeNull();
      expect(on).not.toBeNull();

      // Columns either side of the step, clear of the three its baked coverage
      // ramps over at this width (about 0.2, 0.6 and 0.98 from column 128).
      const left = (x: number) => x < W / 2 - 1;
      const right = (x: number) => x > W / 2 + 2;
      for (let p = 0; p < W * H; p++) {
        if (!left(p % W)) continue;
        for (let ch = 0; ch < 3; ch++) expect(on!.data[p * 4 + ch]).toBe(off!.data[p * 4 + ch]);
      }
      // The copy's chain blurs the whole frame's light, so the glow inside the
      // mask includes what spills from the left half's highlights: the model
      // on the whole scene, compared on the right.
      expectMatch(`masked ${name}`, compare(on!, off!, reference(SCENE, params), W, right));
    });
  });
});
