import { PALETTE, pointSizeFits } from "@/lib/particles/budget";
import { GL_FIELD, GL_FLOATS_PER_PARTICLE } from "@/lib/particles/gl-buffers";
import {
  type GlLook,
  SHIMMER_GROWTH,
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
 * Which particles show: the drawings (the logo, the mice) light only the
 * particles whose rank is under the state's lit share, and draw them as stars;
 * the hand lights them all, as dust (look.ts). Over a leg a particle's
 * visibility goes from its value at the start to its value at the end, by the
 * same `e`, and it keeps the look of the end where it is lit, so a particle
 * that fades out stays the dust it was and one that fades in is already the
 * star it will be. `litness` in look.ts is the same formula.
 *
 * `createGlRendererSteps` ends with null for anything that should send the stage
 * back to Canvas 2D: no WebGL, a shader that does not compile or link, or a GPU
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
attribute float aRank;

uniform vec2 uView;
uniform float uPixel;
uniform float uSplit;
uniform float uE;
uniform float uSwing;
uniform float uBand;
uniform float uBandOn;
uniform float uGrow;
uniform vec2 uFraction;
uniform vec4 uLookFrom;
uniform vec4 uLookTo;
uniform float uFlat;

varying float vBright;
varying float vAlpha;

void main() {
  // Lit at the start and at the end of the leg (rank under the state's share).
  float litFrom = aRank < uFraction.x ? 1.0 : 0.0;
  float litTo = aRank < uFraction.y ? 1.0 : 0.0;
  float shown = uE <= 0.0 ? litFrom : (uE >= 1.0 ? litTo : litFrom + (litTo - litFrom) * uE);
  if (shown <= 0.0) {
    // Not lit anywhere on this leg's step: nothing to draw, and nothing to fill.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 1.0;
    vBright = 0.0;
    vAlpha = 0.0;
    return;
  }

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
  float shine = smoothstep(0.12, 0.5, boost);
  // Where a particle is lit it has that end's look; where it is not, it keeps
  // the look of the other end (it is fading out of, or into, the other state).
  vec4 lookFrom = litFrom > 0.5 ? uLookFrom : uLookTo;
  vec4 lookTo = litTo > 0.5 ? uLookTo : uLookFrom;
  vec4 look = mix(lookFrom, lookTo, uE);
  // prefers-contrast: more is for seeing better: a dot is a solid disc no
  // smaller than the 2D look's (a core 1.7 px across for a bright one, 1.4 px
  // for a dim one), and no fainter.
  float size = mix(look.y, look.x, tone);
  size = max(size, look.x * 0.55 * shine);
  if (uFlat > 0.5) size = max(size, mix(1.7, 2.1, tone));
  size *= 1.0 + uGrow * boost;
  float alpha = mix(look.w, look.z, tone);
  alpha = max(alpha, look.z * min(1.0, 0.35 + boost) * shine);
  if (uFlat > 0.5) alpha = max(alpha, mix(0.72, 1.0, tone));

  vBright = max(tone, shine);
  vAlpha = alpha * shown;
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

// With the halo off: a solid disc with a soft edge, bright or dim.
vec4 solidDot(float r, float bright) {
  float a = 1.0 - smoothstep(0.7, 0.98, r);
  return vec4(mix(DETAIL, PRIMARY, bright) * a, a);
}

void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r >= 1.0) discard;
  if (uGlow < 0.5) {
    gl_FragColor = solidDot(r, vBright) * vAlpha;
    return;
  }
  vec4 bright = withGlow(r);
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
  /** How many particles to draw: the first `count` of the uploaded buffer (the lit ones come first, so a thinned picture loses dust before stars). */
  readonly count: number;
  /** The halo round a bright particle; off for `prefers-contrast: more`, which draws solid discs no smaller or fainter than the 2D look's. */
  readonly glow: boolean;
  /** The share of the particles each end of the leg lights, and each end's look (`legLook`). */
  readonly fractions: readonly [number, number];
  readonly looks: readonly [GlLook, GlLook];
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
  "uFraction",
  "uLookFrom",
  "uLookTo",
  "uFlat",
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
  ["aRank", 1, GL_FIELD.rank],
];

/**
 * Make the renderer on `canvas`, a slice at a time (the stage awaits a task
 * between slices), or null when WebGL can not be used. `onLost` is called when
 * the browser takes the context away; the stage then moves to Canvas 2D for
 * good. The generator yields after the context is made and after each shader
 * is compiled (making the context alone took 13 to 19 ms on a desktop GPU, and
 * compiling and linking a good deal more: one long task at 4 times the CPU).
 * If the generator is closed before it is done (the stage was destroyed
 * between two slices), the context is handed back at once.
 */
export function* createGlRendererSteps(
  canvas: HTMLCanvasElement,
  onLost: () => void,
): Generator<void, GlRenderer | null, void> {
  let gl: WebGLRenderingContext | null = null;
  try {
    // `failIfMajorPerformanceCaveat` is left off on purpose (Claude, 2026-10-06):
    // a browser that only has software WebGL still gets this path, and the
    // slow-frame guard (degrade.ts) is what protects it, by drawing fewer
    // particles. Asking for the caveat to fail would send the headless
    // software WebGL of the e2e runs to Canvas 2D too, and the WebGL path
    // would go untested.
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

  let finished = false;
  try {
    yield;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    yield;
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    yield;
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return giveUp();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return giveUp();
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.useProgram(program);

    const uniform = {} as Record<
      (typeof UNIFORMS)[number],
      WebGLUniformLocation
    >;
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
      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        stride,
        offset * 4,
      );
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
    const handleLost = () => {
      // `preventDefault()` is NOT called: calling it asks the browser to restore
      // the context, and the stage has decided the opposite (it takes the Canvas
      // 2D path for the rest of the visit and never uses this context again), so
      // a context that came back would belong to nobody. Left alone, the browser
      // does not restore it.
      lost = true;
      onLost();
    };
    canvas.addEventListener("webglcontextlost", handleLost);
    const context = gl;

    const renderer: GlRenderer = {
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
        context.uniform2f(
          uniform.uFraction,
          frame.fractions[0],
          frame.fractions[1],
        );
        for (const [location, look] of [
          [uniform.uLookFrom, frame.looks[0]],
          [uniform.uLookTo, frame.looks[1]],
        ] as const) {
          context.uniform4f(
            location,
            look.brightPx,
            look.dimPx,
            look.brightAlpha,
            look.dimAlpha,
          );
        }
        context.uniform1f(uniform.uGlow, frame.glow ? 1 : 0);
        context.uniform1f(uniform.uFlat, frame.glow ? 0 : 1);
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
    finished = true;
    return renderer;
  } finally {
    if (!finished) giveUp();
  }
}
