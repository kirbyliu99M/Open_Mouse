import { PALETTE, pointSizeFits } from "@/lib/particles/budget";
import { GL_FIELD, GL_FLOATS_PER_PARTICLE } from "@/lib/particles/gl-buffers";
import {
  GAIN_SIZE_POWER,
  SHIMMER_GROWTH,
  type GlLook,
  maxPointCssPx,
} from "@/lib/particles/look";

/**
 * WebGL drawing for the home page's particle stage (Home v3, the WebGL stage).
 * Plain WebGL 1, no library, one program, one buffer and one `drawArrays` per
 * frame.
 *
 * The particles' resting positions, swirls, tones and shimmer x are sent once
 * per layout as `STATIC_DRAW` data (`upload`). A frame only sets a few
 * uniforms: where the story is (the leg, `e(t)` and `sin(pi e(t))` from the
 * same `legWeights` the Canvas 2D path uses), the shimmer's band, and the
 * look. The vertex shader then computes
 *
 *   pos = a + (b - a) * e + swirl * sin(pi * e)
 *
 * for every particle, with the ends exact (at e <= 0 a particle is on `a`, at
 * e >= 1 on `b`), the same as `interpolateAxis` in
 * src/lib/particles/interpolate.ts. Scrolling uploads nothing.
 *
 * `createGlRenderer` returns null for anything that should send the stage back
 * to Canvas 2D: no WebGL, a shader that does not compile or link, or a GPU
 * whose largest point is too small. Everything that touches the DOM, and the
 * overlay, stays in particle-stage.ts.
 */

const VERTEX = `
attribute vec2 aLogo;
attribute vec2 aHand;
attribute vec2 aMouse;
attribute vec2 aSwirlForm;
attribute vec2 aSwirlSplit;
attribute vec3 aTone;
attribute float aShimmerX;

uniform vec2 uView;
uniform float uPixel;
uniform float uSplit;
uniform float uE;
uniform float uSwing;
uniform float uBand;
uniform float uBandOn;
uniform float uGrow;
uniform vec4 uLook;
uniform vec2 uGain;

varying float vBright;
varying float vAlpha;

void main() {
  bool split = uSplit > 0.5;
  vec2 a = split ? aHand : aLogo;
  vec2 b = split ? aMouse : aHand;
  vec2 swirl = split ? aSwirlSplit : aSwirlForm;
  vec2 pos = uE <= 0.0 ? a : (uE >= 1.0 ? b : a + (b - a) * uE + swirl * uSwing);
  float from = split ? aTone.y : aTone.x;
  float to = split ? aTone.z : aTone.y;
  float tone = from + (to - from) * uE;

  float boost = 0.0;
  if (uBandOn > 0.5) {
    float d = (aShimmerX - uBand) / 0.14;
    boost = exp(-d * d);
  }
  // A dim particle the band is on turns into a small bright one.
  float lit = smoothstep(0.12, 0.5, boost);
  // A state that is sparser on screen than another is drawn stronger: its gain.
  float gain = mix(uGain.x, uGain.y, uE);
  float size = mix(uLook.y, uLook.x, tone);
  size = max(size, uLook.x * 0.55 * lit);
  size *= (1.0 + uGrow * boost) * pow(gain, ${GAIN_SIZE_POWER.toFixed(2)});
  float alpha = mix(uLook.w, uLook.z, tone);
  alpha = max(alpha, uLook.z * min(1.0, 0.35 + boost) * lit);
  alpha = min(1.0, alpha * gain);

  vBright = max(tone, lit);
  vAlpha = alpha;
  gl_PointSize = size * uPixel;
  gl_Position = vec4(pos.x / uView.x * 2.0 - 1.0, 1.0 - pos.y / uView.y * 2.0, 0.0, 1.0);
}
`;

const vec3 = (hex: string): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => (v / 255).toFixed(4);
  return `vec3(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

/** The same radial gradients the Canvas 2D sprite uses (stage-render.ts), as a function of the distance from the point's centre (0 to 1). */
const FRAGMENT = `
precision mediump float;

uniform float uGlow;

varying float vBright;
varying float vAlpha;

const vec3 PRIMARY = ${vec3(PALETTE.primary)};
const vec3 DETAIL = ${vec3(PALETTE.detail)};
const vec3 GLOW = ${vec3(PALETTE.glow)};

vec4 withGlow(float r) {
  vec3 c;
  float a;
  if (r < 0.16) {
    c = PRIMARY;
    a = mix(1.0, 0.95, r / 0.16);
  } else if (r < 0.30) {
    float t = (r - 0.16) / 0.14;
    c = mix(PRIMARY, DETAIL, t);
    a = mix(0.95, 0.3, t);
  } else {
    float t = (r - 0.30) / 0.70;
    c = mix(DETAIL, GLOW, t);
    a = mix(0.3, 0.0, t);
  }
  return vec4(c * a, a);
}

vec4 withoutGlow(float r) {
  float a = r < 0.2 ? mix(1.0, 0.95, r / 0.2) : max(0.0, 0.95 * (1.0 - (r - 0.2) / 0.08));
  return vec4(PRIMARY * a, a);
}

void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r >= 1.0) discard;
  vec4 bright = uGlow > 0.5 ? withGlow(r) : withoutGlow(r);
  float soft = 1.0 - r * r;
  float da = soft * soft;
  vec4 dim = vec4(DETAIL * da, da);
  gl_FragColor = mix(dim, bright, vBright) * vAlpha;
}
`;

/** What one frame needs: where the story is, and what to light. */
export interface GlFrame {
  /** False: logo to hand. True: hand to the three mice. */
  readonly split: boolean;
  /** `e(t)` and `sin(pi e(t))` of the leg (`legOf(phase).weights`). */
  readonly e: number;
  readonly swing: number;
  /** Where the shimmer's band is across the logo (0 to 1), or null when it is not playing. */
  readonly band: number | null;
  /** How many particles to draw: the first `count` of the uploaded buffer. */
  readonly count: number;
  /** The halo round a bright particle; off for `prefers-contrast: more`. */
  readonly glow: boolean;
  readonly look: GlLook;
  /** The gain of the state the leg starts in and of the one it ends in (`legGain`). */
  readonly gain: readonly [number, number];
}

export interface GlRenderer {
  readonly canvas: HTMLCanvasElement;
  /** True once the browser has taken the context away (or after `dispose`). */
  isLost(): boolean;
  /** Whether the GPU's largest point is big enough for the biggest particle the stage draws, at this pixel ratio. */
  fits(pixelRatio: number): boolean;
  /** Size the drawing buffer. Clears the canvas, so draw again in the same task. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  /** Send the particles (`gl-buffers.ts`'s layout) to the GPU: once per layout. */
  upload(data: Float32Array): void;
  draw(frame: GlFrame): void;
  dispose(): void;
}

function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const UNIFORMS = [
  "uView",
  "uPixel",
  "uSplit",
  "uE",
  "uSwing",
  "uBand",
  "uBandOn",
  "uGrow",
  "uLook",
  "uGain",
  "uGlow",
] as const;

const ATTRIBUTES: readonly (readonly [string, number, number])[] = [
  ["aLogo", 2, GL_FIELD.logo],
  ["aHand", 2, GL_FIELD.hand],
  ["aMouse", 2, GL_FIELD.mouse],
  ["aSwirlForm", 2, GL_FIELD.swirlForm],
  ["aSwirlSplit", 2, GL_FIELD.swirlSplit],
  ["aTone", 3, GL_FIELD.tone],
  ["aShimmerX", 1, GL_FIELD.shimmerX],
];

/**
 * Make the renderer on `canvas`, or null when WebGL can not be used. `onLost`
 * is called when the browser takes the context away; the stage then moves to
 * Canvas 2D for good.
 */
export function createGlRenderer(
  canvas: HTMLCanvasElement,
  onLost: () => void,
): GlRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    gl = null;
  }
  if (!gl || gl.isContextLost()) return null;
  const made = gl;
  // Anything that goes wrong from here hands the context back at once (a page
  // may hold only a few) and tells the stage to use Canvas 2D.
  const giveUp = (): null => {
    if (!made.isContextLost()) {
      made.getExtension("WEBGL_lose_context")?.loseContext();
    }
    return null;
  };

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return giveUp();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return giveUp();
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.useProgram(program);

  const uniform = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation>;
  for (const name of UNIFORMS) {
    const location = gl.getUniformLocation(program, name);
    if (!location) return giveUp();
    uniform[name] = location;
  }
  const buffer = gl.createBuffer();
  if (!buffer) return giveUp();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = GL_FLOATS_PER_PARTICLE * 4;
  for (const [name, size, offset] of ATTRIBUTES) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return giveUp();
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
  }
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied colour, drawn over what is there: a dense stroke settles on
  // its own colour instead of burning out to white, and the order of the
  // particles does not change the picture much.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const range = gl.getParameter(
    gl.ALIASED_POINT_SIZE_RANGE,
  ) as Float32Array | null;
  let lost = false;
  let width = 1;
  let height = 1;
  let pixel = 1;
  const handleLost = (event: Event) => {
    // Without this the browser would never give the context back; the stage
    // does not want it back: it takes the Canvas 2D path for the rest of the
    // visit.
    event.preventDefault();
    lost = true;
    onLost();
  };
  canvas.addEventListener("webglcontextlost", handleLost);
  const context = gl;

  return {
    canvas,
    isLost: () => lost || context.isContextLost(),
    fits: (pixelRatio) => pointSizeFits(range, maxPointCssPx() * pixelRatio),
    resize(cssWidth, cssHeight, pixelRatio) {
      width = cssWidth;
      height = cssHeight;
      pixel = pixelRatio;
      const w = Math.max(1, Math.round(cssWidth * pixelRatio));
      const h = Math.max(1, Math.round(cssHeight * pixelRatio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      context.viewport(0, 0, w, h);
    },
    upload(data) {
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
    },
    draw(frame) {
      context.clear(context.COLOR_BUFFER_BIT);
      context.uniform2f(uniform.uView, width, height);
      context.uniform1f(uniform.uPixel, pixel);
      context.uniform1f(uniform.uSplit, frame.split ? 1 : 0);
      context.uniform1f(uniform.uE, frame.e);
      context.uniform1f(uniform.uSwing, frame.swing);
      context.uniform1f(uniform.uBand, frame.band ?? 0);
      context.uniform1f(uniform.uBandOn, frame.band === null ? 0 : 1);
      context.uniform1f(uniform.uGrow, SHIMMER_GROWTH);
      context.uniform4f(
        uniform.uLook,
        frame.look.brightPx,
        frame.look.dimPx,
        frame.look.brightAlpha,
        frame.look.dimAlpha,
      );
      context.uniform2f(uniform.uGain, frame.gain[0], frame.gain[1]);
      context.uniform1f(uniform.uGlow, frame.glow ? 1 : 0);
      context.drawArrays(context.POINTS, 0, frame.count);
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", handleLost);
      lost = true;
      if (context.isContextLost()) return;
      context.deleteBuffer(buffer);
      context.deleteProgram(program);
      // Hand the context back at once: a page may hold only a few.
      context.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
