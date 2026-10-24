// The bridge between the panel's params and the develop param bag. Every key
// is a scalar under the stage id. `draws` is derived — the draw count Size
// needs while Amount is up, 0 otherwise — and is what the host reads as the
// pass's draw count, so a photo at Amount 0 runs nothing; the inline gates on
// it too, which keeps the stage a bit-exact no-op when the prepass is skipped
// and the host binds another texture as its result.

import { DEFAULT_PARAMS, drawCount, effectActive, type Params } from "./model";

export const EXT_ID = "glow";
export const STAGE_ID = `${EXT_ID}.glow`;

export const SCALAR = ["amount", "size", "threshold", "draws"] as const;
export type Scalar = (typeof SCALAR)[number];

export const KEY: Readonly<Record<Scalar, string>> = Object.fromEntries(
  SCALAR.map((k) => [k, `${STAGE_ID}.${k}`]),
) as Record<Scalar, string>;

export interface Range {
  min: number;
  max: number;
  step: number;
}

export const RANGE: Readonly<Record<"amount" | "size" | "threshold", Range>> = {
  amount: { min: 0, max: 100, step: 1 },
  size: { min: 0, max: 100, step: 1 },
  threshold: { min: 0, max: 100, step: 1 },
};

/** Every qualified key, the controls first. */
export function allKeys(): string[] {
  return SCALAR.map((k) => KEY[k]);
}

export type Bag = Record<string, unknown>;
export type Patch = Record<string, number>;

function num(bag: Bag, key: string, range: Range, fallback: number): number {
  const v = bag[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v < range.min ? range.min : v > range.max ? range.max : v;
}

/** The panel's params from a bag; the defaults for anything missing or foreign. */
export function readParams(bag: Bag): Params {
  return {
    amount: num(bag, KEY.amount, RANGE.amount, DEFAULT_PARAMS.amount),
    size: num(bag, KEY.size, RANGE.size, DEFAULT_PARAMS.size),
    threshold: num(bag, KEY.threshold, RANGE.threshold, DEFAULT_PARAMS.threshold),
  };
}

/** Everything to persist and drive the GPU for a parameter set. */
export function deriveAll(p: Params): Patch {
  return {
    [KEY.amount]: p.amount,
    [KEY.size]: p.size,
    [KEY.threshold]: p.threshold,
    [KEY.draws]: effectActive(p) ? drawCount(p.size) : 0,
  };
}

export function resetPatch(): Patch {
  return deriveAll(DEFAULT_PARAMS);
}

const CONTROL_KEYS = [KEY.amount, KEY.size, KEY.threshold];

/** A bag holding this stage's controls but a draw count that disagrees with
 *  them (a preset that carried only Amount, an edit from another release)
 *  gets the whole patch re-derived; null when the bag has no control keys or
 *  already draws as its controls say. A missing count reads as the uniform's
 *  default, 0, as the host reads it. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!CONTROL_KEYS.some((k) => k in bag)) return null;
  const expected = deriveAll(readParams(bag));
  const draws = bag[KEY.draws];
  const current = typeof draws === "number" && Number.isFinite(draws) ? draws : 0;
  return current === expected[KEY.draws] ? null : expected;
}
