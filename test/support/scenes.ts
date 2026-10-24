// Synthetic scene-linear images for the model and GPU suites. Values live in
// the probe pipeline's linear range so the GPU comparison stays clean.

import type { Image } from "../../src/model";

export type Rgb = readonly [number, number, number];

const rgb = (v: Rgb | number): Rgb => (typeof v === "number" ? [v, v, v] : v);

export function fill(width: number, height: number, texel: (x: number, y: number) => Rgb): Image {
  const data = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = texel(x, y);
      const i = (y * width + x) * 3;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return { data, width, height };
}

export function flat(width: number, height: number, value: Rgb | number): Image {
  const v = rgb(value);
  return fill(width, height, () => v);
}

/** A flat field with a filled disc of another value (pixel centres inside `radius`). */
export function disc(
  width: number,
  height: number,
  field: Rgb | number,
  centre: readonly [number, number],
  radius: number,
  value: Rgb | number,
): Image {
  const f = rgb(field);
  const v = rgb(value);
  return fill(width, height, (x, y) => ((x - centre[0]) ** 2 + (y - centre[1]) ** 2 <= radius * radius ? v : f));
}

/** The pixel at (x, y) of an RGB plane. */
export function pixel(data: Float64Array, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

/** Σ of one channel over the plane. */
export function channelSum(data: Float64Array, ch: number): number {
  let s = 0;
  for (let i = ch; i < data.length; i += 3) s += data[i];
  return s;
}

/** The variance along x of one channel taken as a distribution about `cx`. */
export function varianceX(data: Float64Array, width: number, height: number, ch: number, cx: number): number {
  let m2 = 0;
  let mass = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[(y * width + x) * 3 + ch];
      m2 += v * (x - cx) ** 2;
      mass += v;
    }
  }
  return m2 / mass;
}
