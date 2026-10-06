import { rankOf } from "./look";
import type { ParticleSet } from "./particle-set";

/**
 * What the WebGL stage uploads to the GPU, and in what order (Home v3, the
 * WebGL stage). Everything a particle needs for the whole story is made once
 * per layout, into one interleaved Float32Array, and sent with
 * `STATIC_DRAW`: the three resting positions, the two swirl vectors, the
 * tone at each resting state, the shimmer's x and the rank. Scrolling then only
 * changes a few uniforms. Pure: no DOM, no GL.
 */

/**
 * The floats of one particle, in order: the position on the logo (2), on the
 * hand (2) and on its mouse (2); the swirl of the first leg (2) and of the
 * second (2); the tone on the logo, the hand and the mouse (3); the shimmer's
 * x (1); and the rank (1: the particle's place in the buffer as a share of all
 * of them, `rankOf`; a state lights the particles whose rank is under its lit
 * share).
 */
export const GL_FLOATS_PER_PARTICLE = 15;

/** The offset of each field inside a particle, in floats (the shader's attributes read these). */
export const GL_FIELD = {
  logo: 0,
  hand: 2,
  mouse: 4,
  swirlForm: 6,
  swirlSplit: 8,
  tone: 10,
  shimmerX: 13,
  rank: 14,
} as const;

/**
 * The particle set as one interleaved buffer, in `order` (entry j of the
 * buffer is particle `order[j]`; `star-order.ts` makes it, so that the first
 * particles are an even scatter on every drawing). A particle's fields move
 * together, so its pairing (the same particle on the logo, on the hand and on
 * its mouse) is kept. Its rank is its place j as a share of the count. `out`
 * is reused when it is big enough.
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
    data[at + GL_FIELD.rank] = rankOf(j, n);
  }
  return data;
}
