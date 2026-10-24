// The GPU side of model.ts, formatted from its constants. One pass program
// runs as many draws as the bag's draw count; the host hands each draw the
// previous draw's three channels through readPrev (the current image on the
// first draw, through the split a reads-current stage gets) and binds the
// last draw as `stageResult` for the inline.

import { B3, EPSILON, GAIN, SIZE_FRACTION } from "./model";

/** A GLSL float literal that always carries a decimal point, so integers do
 *  not become int literals and exponents stay valid. */
export function glslLiteral(v: number): string {
  const s = v.toPrecision(10);
  if (/e/i.test(s)) {
    const [mantissa, exponent] = s.split(/e/i);
    const m = mantissa.includes(".") ? mantissa : `${mantissa}.0`;
    return `${m}e${Number(exponent)}`;
  }
  return s.includes(".") ? s : `${s}.0`;
}

const lit = glslLiteral;

// The first draw of a reads-current stage reads the split texture, not the
// raw source, so uPrevRaw is false there; the draw index says which is first.
export const HELPERS_GLSL = `
float glowB3(int d) { d = d < 0 ? -d : d; return d == 0 ? ${lit(B3[2])} : (d == 1 ? ${lit(B3[1])} : ${lit(B3[0])}); }
float glowLinear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 glowLight(vec3 p) {
  float Y = luma(p);
  float T = glowLinear(threshold * 0.01);
  return p * (max(Y - T, 0.0) / max(Y, ${lit(EPSILON)}));
}
vec3 glowLevel(vec2 uv) { vec3 p = readPrev(uv); return uPassIndex == 0 ? glowLight(p) : p; }
`;

export const PASS_GLSL = `
{
  float longEdge = max(1.0 / uTexel.x, 1.0 / uTexel.y);
  float sigma = size * ${lit(SIZE_FRACTION)} * longEdge;
  float s = sigma * inversesqrt((exp2(2.0 * float(uPassCount)) - 1.0) / 3.0) * exp2(float(uPassIndex));
  vec3 sum = vec3(0.0);
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      sum += glowB3(dx) * glowB3(dy) * glowLevel(vUv + vec2(float(dx), float(dy)) * s * uTexel);
    }
  }
  c = sum;
}
`;

export const INLINE_GLSL = `
{
  if (amount > 0.0 && draws > 0.5) {
    lin += amount * ${lit(GAIN)} * max(stageResult, 0.0);
  }
}
`;
