/**
 * The 3D viewer proper: a mouse shell beside a hand scaled to the person's
 * measured lengths, which they can turn with a pointer or the arrow keys.
 *
 * This module is the only one that imports three.js, and `ViewerRegion` loads
 * it with a dynamic `import()` only once the region is near the viewport, so it
 * is its own chunk.
 *
 * A SIZE illustration (docs/PLAN.md M4b, narrowed 2026-10-06): no collision, no
 * contact heat map, no grip posing. Scaling is `handScale`, placement is
 * `handPlacement` (both in src/lib/viewer, both pure and tested); this file only
 * wires them to a scene.
 *
 * Rendering is on demand, not a standing loop: a frame is drawn when something
 * changed (a drag, a coast, a key, the opening turn, a resize). Reduced motion
 * draws one still and then only follows the person's own input, with no opening
 * turn and no momentum. The opening turn ends by itself after
 * `INTRO_DURATION_MS` (WCAG 2.2.2) and any touch of the model ends it at once.
 *
 * Everything it creates is disposed by `dispose()`: geometries, materials,
 * textures, the environment map, the Draco workers, the renderer and its
 * context, and every listener (no leak across navigation).
 */
import {
  Box3,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Material,
  Mesh,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SkinnedMesh,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  handPlacement,
  placedHandBounds,
  unionBounds,
} from "@/lib/viewer/hand-placement";
import {
  handScale,
  scaleAsVector,
  scaleHand,
  type Bounds,
  type Vec3,
} from "@/lib/viewer/hand-scale";
import {
  INTRO_DURATION_MS,
  INTRO_SPEED,
  MOMENTUM_STOP_SPEED,
  boundingRadius,
  cameraPosition,
  coastStep,
  defaultAngles,
  dragAngles,
  fitDistance,
  keyAngles,
  releaseVelocity,
  type OrbitAngles,
  type OrbitVelocity,
  type PointerSample,
} from "@/lib/viewer/orbit";
import { fetchScanMeasurements } from "./fetchMeasurements";

export interface ViewerOptions {
  /** The focusable box: it takes the pointer and key events. */
  box: HTMLElement;
  /** Where the canvas goes (the box's own size is the canvas's size). */
  host: HTMLElement;
  scanId: string;
  /** From `shellUrl`, never from raw input. */
  shellUrl: string;
  onReady: () => void;
  onFailed: () => void;
  onUnsupported: () => void;
}

export interface ViewerHandle {
  dispose: () => void;
}

const HAND_URL = "/models/hand.glb";
const DRACO_PATH = "/draco/";
const FOV_DEG = 32;
/** The hand is drawn see-through, so the mouse stays visible under it from any side. */
const HAND_OPACITY = 0.45;
const MAX_PIXEL_RATIO = 2;

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      // A decoded ImageBitmap holds memory until it is closed.
      const image = value.image as { close?: () => void } | null;
      value.dispose();
      image?.close?.();
    }
  }
  material.dispose();
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials: Material | Material[] = object.material;
      for (const material of Array.isArray(materials) ? materials : [materials])
        disposeMaterial(material);
    }
    if (object instanceof SkinnedMesh) object.skeleton.dispose();
  });
}

const toVec3 = (v: { x: number; y: number; z: number }): Vec3 => [
  v.x,
  v.y,
  v.z,
];

export function startViewer(options: ViewerOptions): ViewerHandle {
  const { box, host } = options;
  let disposed = false;
  const teardown: Array<() => void> = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const step of teardown.reverse()) {
      try {
        step();
      } catch {
        // Disposal must finish whatever one step does.
      }
    }
  };

  // No WebGL: the one thing that is decided before anything is downloaded. The
  // context is asked for here, not by three.js, so that a browser without WebGL
  // gets the calm line and not a console error from the library.
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    powerPreference: "default",
  });
  let renderer: WebGLRenderer;
  try {
    if (!context) throw new Error("no WebGL");
    renderer = new WebGLRenderer({ canvas, context });
  } catch {
    options.onUnsupported();
    return { dispose };
  }
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  teardown.push(() => {
    canvas.remove();
    renderer.dispose();
    renderer.forceContextLoss();
  });

  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
  );

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.01, 10);

  // Image-based light from a procedural room: no HDR file to download.
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  environment.dispose();
  pmrem.dispose();
  teardown.push(() => environmentTarget.dispose());
  scene.add(new HemisphereLight(0xffffff, 0x2a2c33, 0.5));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(0.4, 1, 0.6);
  scene.add(key);

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  draco.preload();
  teardown.push(() => draco.dispose());
  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  // GLTFLoader reads a GLB's embedded textures with ImageBitmapLoader, which
  // fetch()es a blob: URL, and the page's Content-Security-Policy
  // (`connect-src 'self'`, next.config.ts) refuses that: the textures would
  // silently be missing. An <img> may use a blob: URL (`img-src` allows it), so
  // the textures go through TextureLoader. The policy stays as it is.
  gltf.register((parser) => ({
    name: "OPEN_MOUSE_image_textures",
    beforeRoot() {
      const loader = new TextureLoader(parser.options.manager);
      loader.setCrossOrigin(parser.options.crossOrigin);
      parser.textureLoader = loader;
      return null;
    },
  }));

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );

  // ── Camera state ───────────────────────────────────────────────────────────
  let angles: OrbitAngles = defaultAngles("right");
  let target: Vec3 = [0, 0, 0];
  let radius = 0.2;
  let distance = 0.7;
  let handSide: "left" | "right" = "right";
  let width = 1;
  let height = 1;

  const draw = () => {
    const [x, y, z] = cameraPosition(target, distance, angles);
    camera.position.set(x, y, z);
    camera.lookAt(...target);
    renderer.render(scene, camera);
  };

  const resize = () => {
    width = Math.max(host.clientWidth, 1);
    height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    distance = fitDistance(radius, FOV_DEG, camera.aspect);
  };

  // ── Motion: intro turn, coast, drag, keys ──────────────────────────────────
  let frame = 0;
  let lastTime = 0;
  let introMs = 0;
  let introOn = false;
  let velocity: OrbitVelocity | null = null;
  let dragging = false;
  let activePointer = -1;
  let lastX = 0;
  let lastY = 0;
  let samples: PointerSample[] = [];

  const stopMotion = () => {
    introOn = false;
    velocity = null;
  };

  const tick = (now: number) => {
    frame = 0;
    if (disposed) return;
    const dt = lastTime === 0 ? 16 : Math.min(now - lastTime, 64);
    lastTime = now;

    if (introOn && !dragging) {
      introMs += dt;
      angles = {
        ...angles,
        azimuth:
          angles.azimuth +
          (handSide === "right" ? 1 : -1) * INTRO_SPEED * (dt / 1000),
      };
      if (introMs >= INTRO_DURATION_MS) introOn = false;
    }
    if (velocity && !dragging) {
      const step = coastStep(angles, velocity, dt);
      angles = step.angles;
      velocity = step.moving ? step.velocity : null;
    }

    draw();
    if ((introOn || velocity) && !dragging) schedule();
    else lastTime = 0;
  };

  const schedule = () => {
    if (frame === 0 && !disposed) frame = requestAnimationFrame(tick);
  };
  teardown.push(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  });

  // ── Input ──────────────────────────────────────────────────────────────────
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stopMotion();
    dragging = true;
    activePointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    samples = [];
    try {
      box.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic or already-ended pointer cannot be captured; dragging still works.
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointer) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    angles = dragAngles(angles, dx, dy, event.pointerType === "touch");
    samples.push({ t: event.timeStamp, dxPx: dx, dyPx: dy });
    if (samples.length > 12) samples.shift();
    schedule();
  };
  const endDrag = (event: PointerEvent, coast: boolean) => {
    if (!dragging || event.pointerId !== activePointer) return;
    dragging = false;
    try {
      box.releasePointerCapture(event.pointerId);
    } catch {
      // Nothing was captured.
    }
    if (coast && !reducedMotionQuery.matches) {
      const v = releaseVelocity(
        samples,
        event.timeStamp,
        event.pointerType === "touch",
      );
      if (Math.hypot(v.azimuth, v.elevation) > MOMENTUM_STOP_SPEED * 10) {
        velocity = v;
        schedule();
      }
    }
  };
  const onPointerUp = (event: PointerEvent) => endDrag(event, true);
  const onPointerCancel = (event: PointerEvent) => endDrag(event, false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = keyAngles(angles, event.key);
    if (!next) return;
    event.preventDefault();
    stopMotion();
    angles = next;
    schedule();
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    if (!disposed) options.onFailed();
  };

  box.addEventListener("pointerdown", onPointerDown);
  box.addEventListener("pointermove", onPointerMove);
  box.addEventListener("pointerup", onPointerUp);
  box.addEventListener("pointercancel", onPointerCancel);
  box.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("webglcontextlost", onContextLost);
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (disposed) return;
          resize();
          schedule();
        });
  resizeObserver?.observe(host);
  teardown.push(() => {
    box.removeEventListener("pointerdown", onPointerDown);
    box.removeEventListener("pointermove", onPointerMove);
    box.removeEventListener("pointerup", onPointerUp);
    box.removeEventListener("pointercancel", onPointerCancel);
    box.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    resizeObserver?.disconnect();
  });

  // ── Load, build, show ──────────────────────────────────────────────────────
  void (async () => {
    try {
      const [shellModel, handModel, measurements] = await Promise.all([
        gltf.loadAsync(options.shellUrl),
        gltf.loadAsync(HAND_URL),
        fetchScanMeasurements(options.scanId),
      ]);
      if (disposed) {
        disposeObject(shellModel.scene);
        disposeObject(handModel.scene);
        return;
      }
      if (measurements.status !== "ready") {
        disposeObject(shellModel.scene);
        disposeObject(handModel.scene);
        options.onFailed();
        return;
      }
      const { hand: side, measurements: millimetres } = measurements.response;

      const shell = shellModel.scene;
      scene.add(shell);
      teardown.push(() => disposeObject(shell));
      shell.updateMatrixWorld(true);
      const shellBox = new Box3().setFromObject(shell);
      const shellBounds: Bounds = {
        min: toVec3(shellBox.min),
        max: toVec3(shellBox.max),
      };

      const scale = handScale(millimetres);
      const scaled = scaleHand(scale);
      const placement = handPlacement(shellBounds, scaled, side);
      const handRoot = handModel.scene;
      const [sx, sy, sz] = scaleAsVector(scale);
      handRoot.scale.set(placement.mirrorX ? -sx : sx, sy, sz);
      handRoot.position.set(...placement.position);
      handRoot.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.frustumCulled = false;
        object.renderOrder = 2;
        const materials: Material | Material[] = object.material;
        for (const material of Array.isArray(materials)
          ? materials
          : [materials]) {
          material.transparent = true;
          material.opacity = HAND_OPACITY;
          material.depthWrite = false;
          material.side = DoubleSide;
        }
      });
      scene.add(handRoot);
      teardown.push(() => disposeObject(handRoot));

      const union = unionBounds(
        shellBounds,
        placedHandBounds(scaled, placement),
      );
      target = [
        (union.min[0] + union.max[0]) / 2,
        (union.min[1] + union.max[1]) / 2,
        (union.min[2] + union.max[2]) / 2,
      ];
      radius = boundingRadius(union.min, union.max);
      handSide = side;
      angles = defaultAngles(side);
      resize();

      introOn = !reducedMotionQuery.matches;
      draw();
      if (introOn) schedule();
      options.onReady();
    } catch {
      if (!disposed) options.onFailed();
    }
  })();

  return { dispose };
}
