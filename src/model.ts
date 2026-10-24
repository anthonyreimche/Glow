// The maths, pure: the light above a luminance threshold, in the pixel's own
// colour, blurred by a cascade of dilated B3-spline kernels to a Gaussian of
// the asked sigma and added back at the amount. Mirrors the GPU chain
// (glsl.ts) tap for tap — bilinear reads with clamp-to-edge, the finest step
// from the draw count the bag carries — so the SwiftShader run can hold the
// stage to this reference.

export const B3: readonly number[] = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
/** Sigma per Size unit as a fraction of the long edge: Size 100 is 5 %. */
export const SIZE_FRACTION = 0.0005;
/** The long edge (px) the draw count keeps the finest step at or under one texel at. */
export const DRAW_COUNT_EDGE = 8192;
/** The most draws a frame takes; Size 100 at the anchor edge needs ten. */
export const MAX_DRAWS = 10;
/** Glow added per Amount unit: 100 adds the whole blurred excess. */
export const GAIN = 0.01;
/** Guards the luminance division. */
export const EPSILON = 2 ** -16;

export interface Params {
  /** 0…100, the share of the blurred excess added. */
  amount: number;
  /** 0…100, sigma in SIZE_FRACTION of the long edge. */
  size: number;
  /** 0…100, perceptual: through the sRGB curve to linear. */
  threshold: number;
}

export const DEFAULT_PARAMS: Params = { amount: 0, size: 30, threshold: 80 };

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function thresholdLinear(threshold: number): number {
  return srgbToLinear(threshold * 0.01);
}

/** The share of a pixel that scatters: its luminance excess over the
 *  threshold, as a fraction of the luminance. Zero at or below the threshold
 *  and for any luminance at or below zero; the numerator is zero wherever the
 *  divisor could be small. */
export function lightWeight(Y: number, T: number): number {
  return Math.max(Y - T, 0) / Math.max(Y, EPSILON);
}

export function sigmaTexels(size: number, longEdge: number): number {
  return size * SIZE_FRACTION * longEdge;
}

/** The finest step of a cascade of `draws` dilated B3 blurs with this sigma:
 *  level k dilates it by 2^k, and the variances sum to sigma². */
export function baseStep(sigma: number, draws: number): number {
  return sigma / Math.sqrt((4 ** draws - 1) / 3);
}

/** The fewest draws that keep the finest step at or under a texel at
 *  DRAW_COUNT_EDGE, so the first blur never skips texels at any render size
 *  up to it; at least one, at most MAX_DRAWS. */
export function drawCount(size: number): number {
  const sigma = sigmaTexels(size, DRAW_COUNT_EDGE);
  if (sigma <= 0) return 1;
  const k = Math.ceil(Math.log(3 * sigma * sigma + 1) / Math.log(4));
  return Math.min(MAX_DRAWS, Math.max(1, k));
}

export function effectActive(p: Params): boolean {
  return p.amount > 0;
}

export interface Image {
  /** RGB interleaved, top-down rows. */
  data: Float64Array;
  width: number;
  height: number;
}

/** The light that scatters: each pixel scaled by its weight. */
export function glowLight(img: Image, T: number): Float64Array {
  const { data } = img;
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 3) {
    const w = lightWeight(luma(data[i], data[i + 1], data[i + 2]), T);
    out[i] = data[i] * w;
    out[i + 1] = data[i + 1] * w;
    out[i + 2] = data[i + 2] * w;
  }
  return out;
}

/** One channel of an RGB plane read the way the GPU reads a LINEAR /
 *  CLAMP_TO_EDGE texture: bilinear between the four nearest texel centres,
 *  coordinates past the edge held at the edge texel. */
function bilinear(data: Float64Array, width: number, height: number, ch: number, px: number, py: number): number {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const cx0 = x0 < 0 ? 0 : x0 >= width ? width - 1 : x0;
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= width ? width - 1 : x0 + 1;
  const cy0 = y0 < 0 ? 0 : y0 >= height ? height - 1 : y0;
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= height ? height - 1 : y0 + 1;
  const at = (x: number, y: number) => data[(y * width + x) * 3 + ch];
  const top = at(cx0, cy0) * (1 - fx) + at(cx1, cy0) * fx;
  const bottom = at(cx0, cy1) * (1 - fx) + at(cx1, cy1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** The cascade: `draws` passes of the 5×5 B3 kernel, each at twice the step
 *  of the last, from the finest step `baseStep(sigma, draws)`. A step of zero
 *  is the identity and is skipped. */
export function blur(plane: Float64Array, width: number, height: number, sigma: number, draws: number): Float64Array {
  let level = plane;
  const base = baseStep(sigma, draws);
  for (let k = 0; k < draws; k++) {
    const s = base * 2 ** k;
    if (s === 0) continue;
    const next = new Float64Array(plane.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        for (let ch = 0; ch < 3; ch++) {
          let sum = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              sum += B3[dx + 2] * B3[dy + 2] * bilinear(level, width, height, ch, x + dx * s, y + dy * s);
            }
          }
          next[i + ch] = sum;
        }
      }
    }
    level = next;
  }
  return level;
}

/** The image with the glow added: the thresholded light, blurred to the
 *  size, times the amount, never below zero. */
export function applyGlow(img: Image, p: Params): Float64Array {
  const out = new Float64Array(img.data.length);
  if (!effectActive(p)) {
    out.set(img.data);
    return out;
  }
  const longEdge = Math.max(img.width, img.height);
  const halo = blur(
    glowLight(img, thresholdLinear(p.threshold)),
    img.width,
    img.height,
    sigmaTexels(p.size, longEdge),
    drawCount(p.size),
  );
  const gain = p.amount * GAIN;
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] + gain * Math.max(halo[i], 0);
  return out;
}
