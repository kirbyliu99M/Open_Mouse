import { mulberry32 } from "./random";
import type { ParticleSet } from "./particle-set";

/**
 * What the WebGL stage uploads to the GPU, and in what order (Home v3, the
 * WebGL stage). Everything a particle needs for the whole story is made once
 * per layout, into one interleaved Float32Array, and sent with
 * `STATIC_DRAW`: the three resting positions, the two swirl vectors, the
 * tone at each resting state and the shimmer's x. Scrolling then only changes
 * a few uniforms. Pure: no DOM, no GL.
 */

/**
 * The floats of one particle, in order: the position on the logo (2), on the
 * hand (2) and on its mouse (2); the swirl of the first leg (2) and of the
 * second (2); the tone on the logo, the hand and the mouse (3); and the
 * shimmer's x (1).
 */
export const GL_FLOATS_PER_PARTICLE = 14;

/** The offset of each field inside a particle, in floats (the shader's attributes read these). */
export const GL_FIELD = {
  logo: 0,
  hand: 2,
  mouse: 4,
  swirlForm: 6,
  swirlSplit: 8,
  tone: 10,
  shimmerX: 13,
} as const;

/** The seed that shuffles the particle order. Fixed, so a layout always uploads the same buffer. */
export const SHUFFLE_SEED = 20261005;

/**
 * A seeded shuffle of 0 to count - 1 (Fisher-Yates). The pairing sorts the
 * particles by x, so the first N particles of a pairing are only the left of
 * the logo; shuffled, the first N are a fair sample of every shape, and the
 * guard that draws fewer particles on a slow phone loses no piece of the
 * drawing.
 */
export function shuffleOrder(count: number, seed: number): Uint32Array {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError("count must be a non-negative integer");
  }
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i;
  const random = mulberry32(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const held = order[i]!;
    order[i] = order[j]!;
    order[j] = held;
  }
  return order;
}

/**
 * The particle set as one interleaved buffer, in `order` (entry j of the
 * buffer is particle `order[j]`). A particle's fields move together, so its
 * pairing (the same particle on the logo, on the hand and on its mouse) is
 * kept. `out` is reused when it is big enough.
 */
export function packParticles(
  set: ParticleSet,
  order: ArrayLike<number>,
  out?: Float32Array,
): Float32Array {
  const n = set.count;
  if (order.length !== n) {
    throw new RangeError("the order must list every particle once");
  }
  const size = n * GL_FLOATS_PER_PARTICLE;
  const data = out && out.length >= size ? out : new Float32Array(size);
  for (let j = 0; j < n; j += 1) {
    const i = order[j]!;
    const at = j * GL_FLOATS_PER_PARTICLE;
    data[at + GL_FIELD.logo] = set.logo[2 * i]!;
    data[at + GL_FIELD.logo + 1] = set.logo[2 * i + 1]!;
    data[at + GL_FIELD.hand] = set.hand[2 * i]!;
    data[at + GL_FIELD.hand + 1] = set.hand[2 * i + 1]!;
    data[at + GL_FIELD.mouse] = set.mouse[2 * i]!;
    data[at + GL_FIELD.mouse + 1] = set.mouse[2 * i + 1]!;
    data[at + GL_FIELD.swirlForm] = set.swirlForm[2 * i]!;
    data[at + GL_FIELD.swirlForm + 1] = set.swirlForm[2 * i + 1]!;
    data[at + GL_FIELD.swirlSplit] = set.swirlSplit[2 * i]!;
    data[at + GL_FIELD.swirlSplit + 1] = set.swirlSplit[2 * i + 1]!;
    data[at + GL_FIELD.tone] = set.toneLogo[i]!;
    data[at + GL_FIELD.tone + 1] = set.toneHand[i]!;
    data[at + GL_FIELD.tone + 2] = set.toneMouse[i]!;
    data[at + GL_FIELD.shimmerX] = set.shimmerX[i]!;
  }
  return data;
}
