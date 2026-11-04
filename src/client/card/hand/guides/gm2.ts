/**
 * G-M2 極簡框＋卡片槽 (L10 P2, candidate 未拍板): hand brackets, a faint
 * wrist reference line (v3: not a threshold), a middle-finger axis tick, a loose card zone on the
 * little-finger side and a spirit level; the whole layout is mirrored for
 * the left hand. Checks, in the proposal's order (§2): detector, hand,
 * in-frame, distance band, wrist (v3: inside the box, y 0.55–0.88), alignment, per-finger straightness,
 * tilt (green / amber not held / block), steady; then the thumb-side hand
 * against the chosen one (recorded, never held). Every check passing for
 * 1.2 s fires the auto shutter. Rules and numbers live in `../gm2Rules.ts`.
 */
import {
  evaluateGm2Checks,
  GM2_COPY,
  GM2_STEPS,
  GM2_THRESHOLDS,
  gm2Layout,
  type Gm2Layout,
  type InFrameResult,
} from "../gm2Rules";
import { GUIDE_COPY } from "../guideCopy";
import { LM, type Pt } from "../handGeometry";
import type { GuideCheck, HandGuideVersion, OverlayShape, Tone } from "./types";

/** A check's level as an overlay tone; neutral when the check did not run. */
export function toneOf(check: GuideCheck | undefined): Tone {
  if (!check) return "neutral";
  return check.level === "ok" ? "ok" : check.level === "warn" ? "warn" : "fail";
}

/** Arrow size, view 0..1. */
const ARROW = 0.035;

/** Chevrons on the bracket sides the hand sticks out of, pointing back in. */
export function overflowArrows(
  layout: Gm2Layout,
  out: InFrameResult["out"] | null,
): OverlayShape[] {
  if (!out) return [];
  const z = layout.handZone;
  const midX = z.x + z.width / 2;
  const midY = z.y + z.height / 2;
  const a = ARROW;
  const arrows: Pt[][] = [];
  if (out.left > 0) {
    const x = z.x + 0.02;
    arrows.push([
      { x: x - a / 2, y: midY - a },
      { x: x + a / 2, y: midY },
      { x: x - a / 2, y: midY + a },
    ]);
  }
  if (out.right > 0) {
    const x = z.x + z.width - 0.02;
    arrows.push([
      { x: x + a / 2, y: midY - a },
      { x: x - a / 2, y: midY },
      { x: x + a / 2, y: midY + a },
    ]);
  }
  if (out.top > 0) {
    const y = z.y + 0.02;
    arrows.push([
      { x: midX - a, y: y - a / 2 },
      { x: midX, y: y + a / 2 },
      { x: midX + a, y: y - a / 2 },
    ]);
  }
  if (out.bottom > 0) {
    const y = z.y + z.height - 0.03;
    arrows.push([
      { x: midX - a, y: y + a / 2 },
      { x: midX, y: y - a / 2 },
      { x: midX + a, y: y + a / 2 },
    ]);
  }
  return arrows.map((points) => ({
    kind: "polyline" as const,
    points,
    tone: "fail" as const,
    width: 4,
  }));
}

export const gm2: HandGuideVersion = {
  id: "gm2",
  label: "G-M2 極簡框＋卡片槽 v3",
  reference: "card",
  livePaper: false,
  instructions: GM2_STEPS,
  holdMs: GM2_THRESHOLDS.holdMs,
  hintHoldMs: GM2_THRESHOLDS.hintHoldMs,
  layout: (side) => {
    const l = gm2Layout(side);
    return {
      handZone: l.handZone,
      wristLineY: l.wristLineY,
      axisX: l.axisX,
      cardZone: l.cardZone,
      levelAt: l.levelAt,
      thresholds: l.thresholds,
    };
  },
  evaluate(input) {
    const { layout: l, checks, out } = evaluateGm2Checks(input);
    const byId = (id: string) => checks.find((c) => c.id === id);
    const wrist = byId("wrist");
    const overlay: OverlayShape[] = [
      {
        kind: "brackets",
        rect: l.handZone,
        tone: toneOf(byId("inFrame")),
        fill: true,
        label: input.hand ? undefined : GUIDE_COPY.handZone,
      },
      {
        kind: "line",
        from: { x: l.axisX, y: l.handZone.y },
        to: { x: l.axisX, y: l.wristLineY },
        tone: byId("axis")?.level === "fail" ? "warn" : "neutral",
        dashed: true,
        width: 1.5,
      },
      {
        kind: "label",
        at: { x: l.axisX, y: l.handZone.y - 0.015 },
        text: "中軸",
        tone: "neutral",
        anchor: "middle",
      },
      // v3: a faint reference, not a threshold (the wrist dot carries the
      // wrist check's colour).
      {
        kind: "line",
        from: { x: l.handZone.x, y: l.wristLineY },
        to: { x: l.handZone.x + l.handZone.width, y: l.wristLineY },
        tone: "neutral",
        dashed: true,
        width: 1.5,
      },
      {
        kind: "label",
        at: {
          x: l.handZone.x + l.handZone.width / 2,
          y: l.wristLineY + 0.03,
        },
        text: "手腕大約在這附近",
        tone: "neutral",
        anchor: "middle",
      },
      {
        kind: "zone",
        rect: l.cardZone,
        tone: "neutral",
        dashed: true,
        label: input.hand ? undefined : GUIDE_COPY.cardZone,
        card: true,
        faded: input.hand !== null,
      },
      {
        kind: "level",
        at: l.levelAt,
        tiltDeg: input.tiltDeg,
        tone: toneOf(byId("tilt")),
      },
      ...overflowArrows(l, out),
    ];
    if (input.hand && wrist)
      overlay.push({
        kind: "dot",
        at: input.hand.points[LM.wrist],
        tone: toneOf(wrist),
        r: 7,
      });
    return { checks, overlay, okHint: GM2_COPY.ok };
  },
};
