// The GPU stage as a contract: where it runs and what it reads, the keys it
// declares with which defaults (the bag bridge relies on them), that the GLSL
// is formatted from the model's constants, that the inline mutates `lin`
// inside the gate and reads the host's stageResult only, and the per-draw
// texture-fetch budget on the real GLSL — the class of cost the CPU reference
// never sees.

import { describe, expect, it } from "vitest";
import { HELPERS_GLSL, INLINE_GLSL, PASS_GLSL, glslLiteral } from "../src/glsl";
import { B3, DEFAULT_PARAMS, EPSILON, GAIN, MAX_DRAWS, SIZE_FRACTION } from "../src/model";
import { KEY, STAGE_ID } from "../src/params";
import { allStages, glowPass, glowStage } from "../src/stage";
import { fetchBudget, inlineFetches } from "./support/fetch-budget";

describe("glslLiteral", () => {
  it("always carries a decimal point, exponents included", () => {
    expect(glslLiteral(0.5)).toBe("0.5000000000");
    expect(glslLiteral(8192)).toBe("8192.000000");
    expect(glslLiteral(EPSILON)).toBe("0.00001525878906");
    expect(glslLiteral(-5)).toBe("-5.000000000");
    expect(glslLiteral(1.17549435e-38)).toMatch(/^1\.17549435\d*e-38$/);
  });
});

describe("glowStage", () => {
  const stage = glowStage();
  const pass = glowPass();

  it("is one scene-linear stage after local contrast that reads the current image, in presets and masks", () => {
    expect(stage.id).toBe(STAGE_ID);
    expect(stage.name).toBe("Glow");
    expect(stage.phase).toBe("scene-linear");
    expect(stage.priority).toBe(70);
    expect(stage.reads).toBe("current");
    expect(stage.presetScope).toBe("global");
    expect(stage.mask).toEqual({ maskable: true });
    expect(allStages().map((s) => s.id)).toEqual([STAGE_ID]);
  });

  it("draws its one pass as many times as the bag's draw count, up to MAX_DRAWS", () => {
    expect(stage.passes?.length).toBe(1);
    expect(stage.passes?.[0].iterations).toEqual({ key: "draws", max: MAX_DRAWS });
  });

  it("declares Amount and the draw count inline, Size and Threshold on the pass, idle at rest", () => {
    expect(stage.uniforms.map((u) => [u.key, u.glslType, u.default])).toEqual([
      ["amount", "float", 0],
      ["draws", "float", 0],
    ]);
    expect((pass.uniforms ?? []).map((u) => [u.key, u.glslType, u.default])).toEqual([
      ["size", "float", DEFAULT_PARAMS.size],
      ["threshold", "float", DEFAULT_PARAMS.threshold],
    ]);
    const byKey = Object.fromEntries([...stage.uniforms, ...(pass.uniforms ?? [])].map((u) => [u.key, u]));
    expect(byKey.amount.range).toEqual({ min: 0, max: 100, step: 1 });
    expect(byKey.draws.range).toEqual({ min: 0, max: MAX_DRAWS, step: 1 });
    expect(byKey.size.range).toEqual({ min: 0, max: 100, step: 1 });
    expect(byKey.threshold.range).toEqual({ min: 0, max: 100, step: 1 });
    expect(byKey.amount.label).toBe("amount");
    expect(byKey.size.label).toBe("size");
    expect(byKey.threshold.label).toBe("threshold");
    expect(Object.values(KEY).map((k) => k.slice(STAGE_ID.length + 1))).toEqual(["amount", "size", "threshold", "draws"]);
  });

  it("formats the GLSL from the model's constants", () => {
    const glsl = `${pass.helpers}\n${pass.glsl}\n${stage.glsl}`;
    expect(glsl).toContain(`size * ${glslLiteral(SIZE_FRACTION)} * longEdge`);
    expect(glsl).toContain(glslLiteral(EPSILON));
    expect(glsl).toContain(glslLiteral(B3[2]));
    expect(glsl).toContain(glslLiteral(B3[1]));
    expect(glsl).toContain(glslLiteral(B3[0]));
    expect(glsl).toContain(`amount * ${glslLiteral(GAIN)}`);
    expect(pass.glsl).toContain("inversesqrt((exp2(2.0 * float(uPassCount)) - 1.0) / 3.0)");
    expect(pass.glsl).toContain("exp2(float(uPassIndex))");
  });

  it("thresholds on the first draw only and carries the blur afterwards", () => {
    expect(pass.helpers).toContain("uPassIndex == 0 ? glowLight(p) : p");
    expect(pass.helpers).toContain("threshold * 0.01");
    expect(pass.helpers).not.toContain("uPrevRaw");
  });

  it("mutates lin inside the gate and reads only the host's stageResult, never below zero", () => {
    expect(stage.glsl).toMatch(/if \(amount > 0\.0 && draws > 0\.5\)/);
    expect(stage.glsl).toContain("lin += amount * ");
    expect(stage.glsl).toContain("max(stageResult, 0.0)");
    expect(stage.glsl).not.toContain("texture(");
    expect(stage.glsl).not.toContain("texelFetch(");
    expect(stage.helpers).toBeUndefined();
  });

  it("stays within the per-draw texture-fetch budget", () => {
    expect(fetchBudget(pass.glsl, pass.helpers ?? "")).toBe(26);
    expect(inlineFetches(stage.glsl, stage.helpers ?? "")).toBe(0);
  });

  it("exports the same strings the stage carries", () => {
    expect(pass.glsl).toBe(PASS_GLSL);
    expect(pass.helpers).toBe(HELPERS_GLSL);
    expect(stage.glsl).toBe(INLINE_GLSL);
  });
});
