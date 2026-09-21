/**
 * ArUco marker detection adapter — the one place this app calls into
 * `js-aruco2`'s actual detector at runtime (contrast with
 * `src/client/sheet/aruco-codes.ts`, which only needs the dictionary's
 * static bit codes and vendors them instead of importing live; see that
 * file's header for why).
 *
 * `js-aruco2/src/aruco.js` is plain CommonJS that populates a shared `AR`
 * namespace via `this.AR = AR` — relying on top-level `this` being
 * `module.exports`, which is NOT consistent across this app's build
 * targets (confirmed by hand, not just suspected): under Vitest/esbuild,
 * `this` resolves to `module.exports`, so `import arucoModule from
 * "js-aruco2/src/aruco.js"` gets `{ AR, ... }` directly. Under webpack
 * (`next dev`/`next build`, neither script passes `--turbopack`), the same
 * module's top-level `this` resolves to `globalThis` instead —
 * `module.exports` stays `{}` and `AR` ends up as a bare global
 * (`window.AR`). `resolveArucoNamespace` below checks both locations so
 * this adapter works under either. This is also why the `AR.Detector`
 * surface is typed locally here rather than in the project's *shared*
 * ambient declarations (`src/types/js-aruco2.d.ts`, which only types the
 * `DICTIONARIES` shape its own test needs) — every bit of "trust me, this
 * untyped, inconsistently-exported CJS module has a Detector on it" stays
 * contained to this one adapter.
 *
 * `aruco.js` itself has the exact same problem one dependency deeper: its
 * own top level does `var CV = this.CV || require('./cv').CV;` to get
 * `js-aruco2/src/cv.js`'s namespace, and under webpack `this` there is
 * *also* `globalThis`, not `module.exports` — so `require('./cv').CV`
 * alone would be `undefined` too. Importing `cv.js` here, before
 * `aruco.js`, for its side effect (setting `globalThis.CV`) makes
 * `this.CV` already truthy by the time `aruco.js` evaluates that line, so
 * its short-circuit picks up the correctly-populated global instead of a
 * broken `require()` result. `card.ts` needs the identical fix for its own
 * direct `CV` usage.
 *
 * Verified under `next dev`, `next build` and Vitest via
 * `tests/e2e/scan.spec.ts`, which runs the served app in a real browser
 * and asserts markers are actually found in a synthetic photo.
 */
import "js-aruco2/src/cv.js";
import arucoModule from "js-aruco2/src/aruco.js";
import { SHEET } from "../../lib/contracts/measurement";
import type { PointCorrespondence, Point2 } from "../geometry/homography";
import type { SheetLayout } from "../sheet/layout";

interface ArucoDetectedMarker {
  readonly id: number;
  readonly corners: readonly [Point2, Point2, Point2, Point2];
  readonly hammingDistance: number;
}

interface ArucoImageLike {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

interface ArucoDetectorInstance {
  detect(image: ArucoImageLike): ArucoDetectedMarker[];
}

interface ArucoDetectorConstructor {
  new (config?: {
    dictionaryName?: string;
    maxHammingDistance?: number;
  }): ArucoDetectorInstance;
}

interface ArucoRuntime {
  readonly Detector: ArucoDetectorConstructor;
}

function resolveArucoNamespace(): ArucoRuntime {
  const fromModuleExports = (arucoModule as unknown as { AR?: ArucoRuntime })
    ?.AR;
  if (fromModuleExports?.Detector) return fromModuleExports;
  const fromGlobal = (globalThis as unknown as { AR?: ArucoRuntime }).AR;
  if (fromGlobal?.Detector) return fromGlobal;
  throw new Error(
    "js-aruco2's AR namespace initialized on neither the module export nor globalThis.",
  );
}

const AR = resolveArucoNamespace();

/** A marker as found in the photo: id + its 4 corners, in image pixels. */
export interface DetectedMarker {
  readonly id: number;
  /**
   * Clockwise from the marker's own encoded top-left corner (js-aruco2
   * resolves the printed marker's rotation via its dictionary lookup, so
   * this ordering is stable regardless of how the photo itself is
   * rotated) — the same convention `src/client/sheet/layout.ts`'s
   * `squareCorners` uses for the printed corners, which is what makes
   * `buildMarkerCorrespondences` below a plain 1:1 corner match.
   */
  readonly corners: readonly [Point2, Point2, Point2, Point2];
}

let detector: ArucoDetectorInstance | null = null;

function getDetector(): ArucoDetectorInstance {
  detector ??= new AR.Detector({ dictionaryName: SHEET.dictionary });
  return detector;
}

/**
 * Run ArUco detection over a decoded photo. `imageData` is exactly what
 * `CanvasRenderingContext2D.getImageData()` returns: RGBA, one alpha-free
 * grayscale conversion happens inside js-aruco2's own `detect`.
 */
export function detectMarkers(imageData: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): DetectedMarker[] {
  const found = getDetector().detect(imageData);
  return found.map((m) => ({ id: m.id, corners: m.corners }));
}

export interface MarkerCorrespondenceResult {
  readonly correspondences: readonly PointCorrespondence[];
  /** Flat-flap marker ids (0–3) not found in `detected`. */
  readonly missingIds: readonly number[];
  /** Ids that appeared more than once (only the first occurrence is used). */
  readonly duplicateIds: readonly number[];
}

/**
 * Match detected markers to `layout.ts`'s known sheet-mm corners by id,
 * building the 16 point correspondences (4 markers × 4 corners) the
 * homography is estimated from. Pure — no image data, no js-aruco2 —
 * so it's unit-testable with synthetic marker/corner arrays.
 */
export function buildMarkerCorrespondences(
  detected: readonly DetectedMarker[],
  layout: SheetLayout,
): MarkerCorrespondenceResult {
  const flatIds = SHEET.flatMarkerIds as readonly number[];
  const layoutById = new Map(layout.markers.map((m) => [m.id, m]));

  const seen = new Set<number>();
  const duplicateIds: number[] = [];
  const byId = new Map<number, DetectedMarker>();
  for (const marker of detected) {
    if (!flatIds.includes(marker.id)) continue; // upright-flap markers aren't part of the top-down homography
    if (seen.has(marker.id)) {
      duplicateIds.push(marker.id);
      continue;
    }
    seen.add(marker.id);
    byId.set(marker.id, marker);
  }

  const missingIds = flatIds.filter((id) => !byId.has(id));

  const correspondences: PointCorrespondence[] = [];
  for (const id of flatIds) {
    const marker = byId.get(id);
    const layoutMarker = layoutById.get(id);
    if (!marker || !layoutMarker) continue;
    for (let i = 0; i < 4; i++) {
      correspondences.push({
        src: marker.corners[i],
        dst: layoutMarker.corners[i],
      });
    }
  }

  return { correspondences, missingIds, duplicateIds };
}
