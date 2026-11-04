/**
 * v3.4 card reference (2026-11-05, candidate 未拍板): the card mode's
 * wiring, ported from the scan lab (`src/client/lab/cardLab.ts`, L10-L14,
 * commit 5e02f63c). Only what the product needs: the two-pass card search
 * of a hand shot, the crop's principal point, and the tilt of a sensor
 * window (recorded only: the measurement is card-only, cardHandMeasure.ts).
 * The lab's per-phone calibration (`LAB_PHONE_CALIBRATION`, Kirby's phone
 * only) and card + tilt `H_card` are deliberately NOT ported.
 *
 * Pure.
 */
import type {
  CardDetection,
  CardFailureCode,
  PixelRect,
} from "./detect/detectCard";
import type { SensorSnapshot } from "./tilt";

/** The tilt of the snapshot's window, degrees, or `null` (for the record and the gate). */
export function tiltDegFromSensor(
  sensor: SensorSnapshot | null,
): number | null {
  const t = sensor?.motion.around?.tiltDeg;
  return typeof t === "number" && Number.isFinite(t) ? t : null;
}

/** Which detector pass a hand shot's card answer came from. */
export type CardSearchPass = "slot" | "hand-side";

/** The two boxes one `detectCard` run is given. */
export interface CardSearchBoxes {
  readonly searchRegion: PixelRect | null;
  readonly linesRegion: PixelRect | null;
}

export interface CardSearchOutcome extends CardSearchBoxes {
  readonly detection: CardDetection;
  readonly searchPass: CardSearchPass | null;
  readonly slotFailure: CardFailureCode | null;
}

/**
 * The card search of a hand shot, in up to two passes (lab L14). `detect`
 * runs the detector with the boxes it is given.
 * - No slot: one pass, the whole frame and then `handSide` for the
 *   straight-edge search.
 * - A slot: the slot first. When it finds the card, that is the answer.
 *   When it finds none and there is a hand-side box, the detector runs
 *   again the no-slot way (whole frame, then `handSide`) and that second
 *   answer is kept, found or not.
 * Pure apart from what `detect` does.
 */
export function detectCardInPasses(
  detect: (boxes: CardSearchBoxes) => CardDetection,
  slot: PixelRect | null,
  handSide: PixelRect | null,
): CardSearchOutcome {
  if (!slot) {
    const boxes = { searchRegion: null, linesRegion: handSide };
    return {
      ...boxes,
      detection: detect(boxes),
      searchPass: null,
      slotFailure: null,
    };
  }
  const first = detect({ searchRegion: slot, linesRegion: null });
  if (first.ok || !handSide)
    return {
      searchRegion: slot,
      linesRegion: null,
      detection: first,
      searchPass: "slot",
      slotFailure: null,
    };
  return {
    searchRegion: slot,
    linesRegion: handSide,
    detection: detect({ searchRegion: null, linesRegion: handSide }),
    searchPass: "hand-side",
    slotFailure: first.failure,
  };
}

/**
 * The principal point of a crop of the stream: the stream's centre moved by
 * the crop's offset (the crop does not change the focal length in px).
 */
export function cropPrincipalPoint(
  stream: { readonly width: number; readonly height: number },
  crop: { readonly x: number; readonly y: number },
): { readonly cx: number; readonly cy: number } {
  return { cx: stream.width / 2 - crop.x, cy: stream.height / 2 - crop.y };
}
