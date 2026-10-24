// The maths as a contract: the constants the spec pins, the point functions,
// the draw count that keeps the finest step at or under a texel, and the
// glow's behaviour on synthetic scenes: identity at rest, a flat field above
// the threshold gaining exactly its excess, nothing below it, a spot's light
// spreading into a halo of the nominal width with the spot's colour.

import { describe, expect, it } from "vitest";
import {
  B3,
  DEFAULT_PARAMS,
  DRAW_COUNT_EDGE,
  EPSILON,
  GAIN,
  MAX_DRAWS,
  SIZE_FRACTION,
  applyGlow,
  baseStep,
  blur,
  drawCount,
  effectActive,
  glowLight,
  lightWeight,
  luma,
  sigmaTexels,
  srgbToLinear,
  thresholdLinear,
  type Params,
} from "../src/model";
import { channelSum, disc, fill, flat, pixel, varianceX, type Rgb } from "./support/scenes";

describe("constants", () => {
  it("pins the spec's values", () => {
    expect(B3).toEqual([1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]);
    expect(SIZE_FRACTION).toBe(0.0005);
    expect(DRAW_COUNT_EDGE).toBe(8192);
    expect(MAX_DRAWS).toBe(10);
    expect(GAIN).toBe(0.01);
    expect(EPSILON).toBe(2 ** -16);
    expect(DEFAULT_PARAMS).toEqual({ amount: 0, size: 30, threshold: 80 });
  });

  it("has a kernel of unit variance per unit step", () => {
    const variance = B3.reduce((s, w, i) => s + w * (i - 2) ** 2, 0);
    expect(B3.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
    expect(variance).toBeCloseTo(1, 12);
  });
});

describe("point functions", () => {
  it("takes Rec. 709 luma", () => {
    expect(luma(1, 1, 1)).toBeCloseTo(1, 12);
    expect(luma(1, 0, 0)).toBeCloseTo(0.2126, 12);
    expect(luma(0, 1, 0)).toBeCloseTo(0.7152, 12);
    expect(luma(0, 0, 1)).toBeCloseTo(0.0722, 12);
  });

  it("maps the threshold through the sRGB curve", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(thresholdLinear(0)).toBe(0);
    expect(thresholdLinear(100)).toBeCloseTo(1, 12);
    expect(thresholdLinear(50)).toBeCloseTo(0.21404114, 7);
    expect(thresholdLinear(80)).toBeCloseTo(0.60382735, 7);
    for (let t = 1; t <= 100; t++) expect(thresholdLinear(t)).toBeGreaterThan(thresholdLinear(t - 1));
  });

  it("weights the light that scatters: zero at and below the threshold, the excess share above", () => {
    expect(lightWeight(0.5, 0.6)).toBe(0);
    expect(lightWeight(0.6, 0.6)).toBe(0);
    expect(lightWeight(1.0, 0.6)).toBeCloseTo(0.4, 12);
    expect(lightWeight(1.0, 0)).toBeCloseTo(1, 12);
    expect(lightWeight(-0.1, 0)).toBe(0);
    expect(lightWeight(0, 0)).toBe(0);
    expect(lightWeight(EPSILON / 4, 0)).toBeLessThanOrEqual(1);
    expect(Number.isFinite(lightWeight(EPSILON / 4, 0))).toBe(true);
  });

  it("anchors sigma to the long edge", () => {
    expect(sigmaTexels(100, 4096)).toBeCloseTo(204.8, 12);
    expect(sigmaTexels(30, 2560)).toBeCloseTo(38.4, 12);
    expect(sigmaTexels(0, 4096)).toBe(0);
  });

  it("picks the fewest draws that keep the finest step at or under a texel at the anchor edge", () => {
    expect([0, 1, 2, 10, 30, 50, 100].map(drawCount)).toEqual([1, 3, 4, 7, 8, 9, 10]);
    for (let size = 1; size <= 100; size++) {
      const draws = drawCount(size);
      const base = baseStep(sigmaTexels(size, DRAW_COUNT_EDGE), draws);
      expect(draws).toBeGreaterThanOrEqual(1);
      expect(draws).toBeLessThanOrEqual(MAX_DRAWS);
      expect(base).toBeLessThanOrEqual(1);
      expect(base).toBeGreaterThan(0.45);
    }
    expect(baseStep(0, 1)).toBe(0);
  });

  it("composes the cascade to the asked sigma", () => {
    for (const [sigma, draws] of [
      [4, 3],
      [40, 7],
      [204.8, 10],
    ]) {
      const base = baseStep(sigma, draws);
      let variance = 0;
      for (let k = 0; k < draws; k++) variance += (base * 2 ** k) ** 2;
      expect(Math.sqrt(variance)).toBeCloseTo(sigma, 9);
    }
  });

  it("is active once Amount leaves zero", () => {
    expect(effectActive(DEFAULT_PARAMS)).toBe(false);
    expect(effectActive({ ...DEFAULT_PARAMS, size: 90, threshold: 10 })).toBe(false);
    expect(effectActive({ ...DEFAULT_PARAMS, amount: 1 })).toBe(true);
  });
});

const T50 = thresholdLinear(50);

describe("applyGlow", () => {
  it("is the identity at Amount 0, whatever Size and Threshold", () => {
    const img = disc(32, 24, 0.05, [16, 12], 4, 0.5);
    for (const p of [DEFAULT_PARAMS, { amount: 0, size: 100, threshold: 0 }, { amount: 0, size: 0, threshold: 100 }]) {
      expect(applyGlow(img, p)).toEqual(img.data);
    }
  });

  it("adds exactly the excess over the threshold to a flat field above it", () => {
    const img = flat(16, 16, 0.5);
    const out = applyGlow(img, { amount: 60, size: 30, threshold: 50 });
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(0.5 + 0.6 * (0.5 - T50), 12);
  });

  it("keeps a flat field's colour ratios: the light is the pixel scaled by its luma excess", () => {
    const rgb: readonly [number, number, number] = [0.6, 0.5, 0.4];
    const img = flat(16, 16, rgb);
    const w = lightWeight(luma(...rgb), T50);
    const out = applyGlow(img, { amount: 100, size: 30, threshold: 50 });
    expect(w).toBeGreaterThan(0);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(img.data[i] * (1 + w), 12);
  });

  it("leaves a flat field below the threshold alone", () => {
    for (const v of [0.15, T50 * 0.999]) {
      const img = flat(16, 16, v);
      expect(applyGlow(img, { amount: 100, size: 30, threshold: 50 })).toEqual(img.data);
    }
  });

  it("spreads a spot's light into a halo that holds the light and dims with distance", () => {
    const img = disc(128, 128, 0.05, [64, 64], 3, 0.5);
    const p: Params = { amount: 50, size: 40, threshold: 50 };
    const out = applyGlow(img, p);
    const light = glowLight(img, T50);
    const added = out.map((v, i) => v - img.data[i]);
    expect(channelSum(added, 0)).toBeCloseTo(0.5 * channelSum(light, 0), 6);
    const at = (d: number) => pixel(added, 128, 64 + d, 64)[0];
    expect(at(0)).toBeGreaterThan(0);
    expect(at(0)).toBeLessThan(0.5 * (0.5 - T50));
    expect(at(6)).toBeGreaterThan(0);
    expect(at(6)).toBeLessThan(at(0));
    expect(at(14)).toBeGreaterThan(0);
    expect(at(14)).toBeLessThan(at(6));
    expect(at(60)).toBeCloseTo(0, 6);
  });

  it("reaches further and peaks lower at a larger Size", () => {
    const img = disc(128, 128, 0.05, [64, 64], 3, 0.5);
    const narrow = applyGlow(img, { amount: 50, size: 20, threshold: 50 });
    const wide = applyGlow(img, { amount: 50, size: 60, threshold: 50 });
    const centre = (out: Float64Array) => pixel(out, 128, 64, 64)[0];
    const far = (out: Float64Array) => pixel(out, 128, 64 + 16, 64)[0];
    expect(centre(wide)).toBeLessThan(centre(narrow));
    expect(far(wide)).toBeGreaterThan(far(narrow));
  });

  it("gives the halo the spot's colour", () => {
    const spot: readonly [number, number, number] = [0.6, 0.3, 0.2];
    const img = disc(96, 96, 0.02, [48, 48], 3, spot);
    const out = applyGlow(img, { amount: 100, size: 30, threshold: 20 });
    const [r, g, b] = pixel(out, 96, 48 + 8, 48).map((v, ch) => v - img.data[((48 * 96 + 56) * 3) + ch]);
    expect(r).toBeGreaterThan(1e-4);
    expect(g / r).toBeCloseTo(spot[1] / spot[0], 9);
    expect(b / r).toBeCloseTo(spot[2] / spot[0], 9);
  });

  it("keeps channels below black finite and drops a negative glow", () => {
    const img = fill(32, 32, (x): Rgb => (x === 16 ? [1.2, 0.9, -0.3] : [0.02, 0.02, -0.01]));
    const out = applyGlow(img, { amount: 100, size: 30, threshold: 50 });
    expect(out.every(Number.isFinite)).toBe(true);
    for (let i = 2; i < out.length; i += 3) expect(out[i]).toBeGreaterThanOrEqual(img.data[i]);
    expect(pixel(out, 32, 16, 16)[0]).toBeGreaterThan(1.2);
  });
});

describe("blur", () => {
  it("has the nominal sigma on an impulse, bilinear taps included", () => {
    // Tall enough that the cascade's reach (its support plus a texel of
    // bilinear spill per draw) stays inside the frame, so no mass is lost.
    const w = 257;
    const h = 129;
    const plane = fill(w, h, (x, y) => (x === 128 && y === 64 ? [1, 1, 1] : [0, 0, 0])).data;
    for (const [sigma, draws] of [
      [8, 9],
      [12, 10],
    ]) {
      const out = blur(plane, w, h, sigma, draws);
      expect(channelSum(out, 0)).toBeCloseTo(1, 9);
      expect(Math.abs(Math.sqrt(varianceX(out, w, h, 0, 128)) - sigma)).toBeLessThan(0.1 * sigma);
    }
  });

  it("is the identity at sigma 0", () => {
    const plane = disc(16, 16, 0, [8, 8], 2, 1).data;
    expect(blur(plane, 16, 16, 0, 1)).toEqual(plane);
  });

  it("holds the edge texel past the border, so a constant stays constant", () => {
    const plane = flat(24, 16, [0.3, 0.2, 0.1]).data;
    const out = blur(plane, 24, 16, 6, 8);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(plane[i], 10);
  });
});
