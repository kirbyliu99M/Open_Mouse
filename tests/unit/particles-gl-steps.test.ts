import { describe, expect, it, vi } from "vitest";
import { createGlRendererSteps } from "@/components/home/stage-gl";

/**
 * `createGlRendererSteps` with a made-up canvas and WebGL context (no real
 * WebGL: only the calls the setup makes). What is tested is the hand-back: a
 * generator closed between two slices (the stage was destroyed, and the stage
 * calls `steps.return(null)`) gives the context back at once.
 */
function fake({
  compiles = true,
  context = true,
  lost = false,
}: { compiles?: boolean; context?: boolean; lost?: boolean } = {}) {
  let isLost = lost;
  const loseContext = vi.fn(() => {
    isLost = true;
  });
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    FLOAT: 6,
    DEPTH_TEST: 7,
    BLEND: 8,
    ONE: 9,
    ONE_MINUS_SRC_ALPHA: 10,
    ALIASED_POINT_SIZE_RANGE: 11,
    isContextLost: () => isLost,
    getExtension: (name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => compiles,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    useProgram: () => {},
    getUniformLocation: () => ({}),
    createBuffer: () => ({}),
    bindBuffer: () => {},
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    disable: () => {},
    enable: () => {},
    blendFunc: () => {},
    clearColor: () => {},
    getParameter: () => new Float32Array([1, 256]),
  };
  const canvas = {
    getContext: vi.fn(() => (context ? gl : null)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { canvas, loseContext };
}

const steps = (f: ReturnType<typeof fake>) =>
  createGlRendererSteps(f.canvas as unknown as HTMLCanvasElement, () => {});

/** Run to the end: how many times it yielded, and what it returned. */
function finish(generator: ReturnType<typeof steps>) {
  let yields = 0;
  for (;;) {
    const next = generator.next();
    if (next.done) return { yields, value: next.value };
    yields += 1;
  }
}

describe("createGlRendererSteps", () => {
  it("makes the renderer in slices (the context, then each shader), keeps the context, and listens for its loss", () => {
    const f = fake();
    const { yields, value } = finish(steps(f));
    expect(yields).toBe(3);
    expect(value).not.toBeNull();
    expect(f.loseContext).not.toHaveBeenCalled();
    expect(f.canvas.addEventListener).toHaveBeenCalledTimes(1);
    expect(f.canvas.addEventListener.mock.calls[0]![0]).toBe(
      "webglcontextlost",
    );
  });

  it("gives the context back at once when it is closed between two slices, at every slice, and leaves no listener", () => {
    for (let slices = 1; slices <= 3; slices += 1) {
      const f = fake();
      const generator = steps(f);
      for (let i = 0; i < slices; i += 1) {
        expect(generator.next().done, `slice ${i + 1}`).toBe(false);
      }
      // The stage was destroyed: it closes the generator.
      expect(generator.return(null)).toEqual({ done: true, value: null });
      expect(
        f.loseContext,
        `closed after ${slices} slices`,
      ).toHaveBeenCalledTimes(1);
      expect(f.canvas.addEventListener).not.toHaveBeenCalled();
      // Nothing more comes out of it.
      expect(generator.next()).toEqual({ done: true, value: undefined });
      expect(f.loseContext).toHaveBeenCalledTimes(1);
    }
  });

  it("closing it raises no unhandled rejection", async () => {
    const seen: unknown[] = [];
    const listener = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const f = fake();
      const generator = steps(f);
      generator.next();
      generator.return(null);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", listener);
    }
    expect(seen).toEqual([]);
  });

  it("closing it after it is done does nothing: the renderer keeps its context", () => {
    const f = fake();
    const generator = steps(f);
    finish(generator);
    generator.return(null);
    expect(f.loseContext).not.toHaveBeenCalled();
  });

  it("a shader that does not compile ends with null and gives the context back once", () => {
    const f = fake({ compiles: false });
    const { value } = finish(steps(f));
    expect(value).toBeNull();
    expect(f.loseContext).toHaveBeenCalledTimes(1);
  });

  it("no context to be had, or one that is already lost, ends with null at once, without a slice and without handing anything back", () => {
    for (const options of [{ context: false }, { lost: true }]) {
      const f = fake(options);
      const { yields, value } = finish(steps(f));
      expect(yields).toBe(0);
      expect(value).toBeNull();
      expect(f.loseContext).not.toHaveBeenCalled();
    }
  });
});
