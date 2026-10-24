# Glow for SafeLight

A [SafeLight](https://github.com/anthonyreimche/SafeLight) extension that lets
highlights bloom into their surroundings. The pixels brighter than a threshold
are taken as light sources, blurred to a size, and added back to the photo in
linear light before the tone curve, the way a lens scatters light: a lamp
glows into the dark around it, a window spills onto the wall, and at threshold
0 the whole photo softens into the classic diffused look.

## What it does

- **Amount** (0…100). How much of the blurred light is added. 0 is off and
  costs nothing; 100 adds the whole blurred excess over the threshold.
- **Size** (0…100). How far the glow reaches, as a fraction of the frame:
  100 is a blur sigma of 5 % of the long edge. The same halo in Develop,
  thumbnails and export.
- **Threshold** (0…100). Which brightness counts as a light, on the
  perceptual scale of the histogram: 50 sits just above middle grey, 100 is
  display white, so at 100 only highlights beyond white glow. At 0 everything
  glows and the photo diffuses.
- **In masks:** add Glow to a mask from the Masking panel's Adjust tab to run
  a second glow inside that mask only, with its own three controls. It needs
  the current processing: on a photo edited in an earlier Safelight, use
  Update processing first.
- **Reset** from the panel's dock header menu.

The glow keeps each light's colour: a red lamp glows red, a white one white.
Because it is added in linear light, the core tone curve rolls the brightened
highlights off instead of clipping them, and a brighter exposure glows more,
as a real lens does. Settings persist per photo, take part in undo and
presets, and the stage is a bit-exact no-op until Amount leaves zero.

## The math

- **Light.** With `Y` the Rec. 709 luminance of a pixel and `T` the threshold
  through the sRGB curve, the light that scatters is `rgb · max(Y − T, 0) / Y`:
  the excess over the threshold, in the pixel's colour, zero at or below it.
- **Blur.** A cascade of 5×5 B3-spline blurs (`[1 4 6 4 1]/16`), each at
  twice the step of the last, which compose to a Gaussian of
  `σ² = base² · (4^K − 1) / 3`. `σ` is `Size × 0.05 %` of the long edge; `K`
  is the fewest draws that keep the finest step at or under one texel on an
  8192-px frame (1 to 10), so the first blur never skips texels, and the
  finest step follows from `σ` and `K`.
- **Glow.** `rgb + Amount / 100 · blur(light)`, never below zero.

### How it maps onto SafeLight

One stage in SafeLight's scene-linear phase on the stage/prepass framework,
reading the image as the tools before it leave it. A single pass program is
drawn as many times as Size needs (the draw count travels with the edit), each
draw one 5×5 step of 26 texture reads per pixel on the previous draw's
three channels; the inline adds the last draw to the live scene-linear pixel.
SafeLight caches the result until Size, Threshold, the source or anything
upstream (exposure included) changes, so dragging Amount costs nothing and a
Size drag costs up to ten draws.

Things to know:

- The chain needs SafeLight's float render targets (`EXT_color_buffer_float`,
  present on every desktop GPU). Without them the host reads the source
  instead of the current image, and the glow then thresholds the un-exposed
  photo.
- A mask's copy of the stage blurs the whole frame's light and is blended in by
  the mask's coverage, so a highlight just outside a mask still spills into
  it. Each mask that uses Glow runs its own draws.
- Channels below black (RAW colours beyond the sRGB primaries) give a glow
  component below black; it is dropped, so the glow only ever adds light.

### Tests

`npm test` runs on the CPU: the model on synthetic scenes (identity at rest, a
flat field above the threshold gaining exactly its excess, nothing below it, a
spot's light spreading into a halo of the nominal width with the spot's
colour, finite on channels below black), the bag bridge, the stage contract
with a **per-draw texture-fetch budget** on the real GLSL, the slider table,
and the activation contract.

`npm run test:gpu` runs the stage through a SafeLight checkout's WebGL harness
(headless Chromium on SwiftShader): the pass and the inline compile, Amount 0
is a bit-exact no-op, and on a 256² scene of discs, a bar and a soft bump over
a darker field the render matches the CPU model for five parameter sets to
under 2 % of the change with no sample off by more than 0.01, then again at
96×64 and at +1 EV; a mask over the right half runs its own glow there and
leaves the left half bit-identical. It needs the SafeLight repository beside
this one (or `SAFELIGHT_CORE=<path>`) with its dev dependencies installed.

## Install

Install from the SafeLight **Extensions** window, or load this folder via
Developer Tools ▸ Extensions during development. A **Glow** panel appears in
Develop (right dock). Build from source with `npm install && npm run build`
(outputs `dist/index.js`). Needs SafeLight 3.1.0 or later.

## License & credits

**MIT.** An original implementation from textbook parts: the thresholded
additive bloom of real-time rendering, and the undecimated B3-spline cascade
(Starck, Murtagh & Bijaoui's *à trous* algorithm) as a wide Gaussian in a
fixed per-draw budget. No code from other projects is used.
