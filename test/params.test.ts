// The bag bridge as a contract: the keys, what a foreign or partial bag reads
// as, the clamps, the derived draw count, and re-derivation when a loaded
// bag's draw count disagrees with its Amount and Size.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, drawCount } from "../src/model";
import { EXT_ID, KEY, RANGE, STAGE_ID, allKeys, deriveAll, readParams, rederivePatch, resetPatch } from "../src/params";

describe("keys", () => {
  it("live under the stage id", () => {
    expect(EXT_ID).toBe("glow");
    expect(STAGE_ID).toBe("glow.glow");
    expect(KEY.amount).toBe("glow.glow.amount");
    expect(KEY.size).toBe("glow.glow.size");
    expect(KEY.threshold).toBe("glow.glow.threshold");
    expect(KEY.draws).toBe("glow.glow.draws");
    expect(allKeys()).toEqual([KEY.amount, KEY.size, KEY.threshold, KEY.draws]);
  });

  it("pins the slider ranges", () => {
    expect(RANGE.amount).toEqual({ min: 0, max: 100, step: 1 });
    expect(RANGE.size).toEqual({ min: 0, max: 100, step: 1 });
    expect(RANGE.threshold).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("readParams", () => {
  it("reads the defaults from an empty bag", () => {
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("reads each key, defaulting foreign values and clamping", () => {
    expect(readParams({ [KEY.amount]: 40, [KEY.size]: "x", [KEY.threshold]: 250 })).toEqual({
      amount: 40,
      size: 30,
      threshold: 100,
    });
    expect(readParams({ [KEY.amount]: -5, [KEY.size]: Number.NaN, [KEY.threshold]: Number.POSITIVE_INFINITY })).toEqual({
      amount: 0,
      size: 30,
      threshold: 80,
    });
  });
});

describe("deriveAll / resetPatch", () => {
  it("writes every key and the draw count Size needs while Amount is up", () => {
    const patch = deriveAll({ amount: 35, size: 30, threshold: 50 });
    expect(Object.keys(patch).sort()).toEqual(allKeys().sort());
    expect(patch[KEY.amount]).toBe(35);
    expect(patch[KEY.size]).toBe(30);
    expect(patch[KEY.threshold]).toBe(50);
    expect(patch[KEY.draws]).toBe(drawCount(30));
    expect(deriveAll({ amount: 35, size: 100, threshold: 50 })[KEY.draws]).toBe(10);
    expect(deriveAll({ amount: 35, size: 0, threshold: 50 })[KEY.draws]).toBe(1);
  });

  it("derives no draws at Amount 0, so the stage is idle", () => {
    expect(deriveAll({ amount: 0, size: 100, threshold: 0 })[KEY.draws]).toBe(0);
  });

  it("round-trips through the bag", () => {
    const p = { amount: 12, size: 77, threshold: 3 };
    expect(readParams(deriveAll(p))).toEqual(p);
  });

  it("resets to the defaults with no draws", () => {
    expect(resetPatch()).toEqual({ [KEY.amount]: 0, [KEY.size]: 30, [KEY.threshold]: 80, [KEY.draws]: 0 });
  });
});

describe("rederivePatch", () => {
  it("is null for a bag without this stage's controls", () => {
    expect(rederivePatch({})).toBeNull();
    expect(rederivePatch({ [KEY.draws]: 4, "other.stage.amount": 3 })).toBeNull();
  });

  it("is null when the draw count agrees", () => {
    expect(rederivePatch(deriveAll({ amount: 40, size: 30, threshold: 80 }))).toBeNull();
    expect(rederivePatch(deriveAll(DEFAULT_PARAMS))).toBeNull();
    expect(rederivePatch({ [KEY.size]: 60 })).toBeNull();
  });

  it("re-derives when a preset carried Amount but no draw count, or a stale one", () => {
    expect(rederivePatch({ [KEY.amount]: 40 })).toEqual(deriveAll({ amount: 40, size: 30, threshold: 80 }));
    const stale = { ...deriveAll({ amount: 40, size: 100, threshold: 80 }), [KEY.draws]: 3 };
    expect(rederivePatch(stale)?.[KEY.draws]).toBe(10);
    const off = { ...deriveAll({ amount: 0, size: 100, threshold: 80 }), [KEY.draws]: 10 };
    expect(rederivePatch(off)?.[KEY.draws]).toBe(0);
  });
});
