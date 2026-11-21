// Radeon radeonsi runs mediump as fp16 (max 65504, integers exact to 2048).
import { describe, expect, it } from "vitest";
import { PASS_GLSL } from "../src/glsl";

describe("pass GLSL precision", () => {
  it("builds the exp2 scales from highp float locals, not the mediump pass ints", () => {
    expect(PASS_GLSL).not.toMatch(/exp2\([^)]*float\(uPass/);
    expect(PASS_GLSL).toContain("float passCount = float(uPassCount);");
    expect(PASS_GLSL).toContain("float passIndex = float(uPassIndex);");
    expect(PASS_GLSL).toContain("exp2(2.0 * passCount)");
  });
});
