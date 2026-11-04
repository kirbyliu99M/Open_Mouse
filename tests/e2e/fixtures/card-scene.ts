/**
 * v3.4 card reference (candidate): a synthetic "camera view of a hand on a
 * dark table with a light card beside the little finger", for the committed
 * fake-camera fixture `camera/card-beside-hand.y4m` (gen-camera-fixtures.spec.ts).
 *
 * No real photo is used (photos never enter the repo). The card is an ID-1
 * card (85.6 x 53.98 mm, 3.18 mm corner radius) drawn upright inside the
 * G-M2 card slot of a right hand, as the guide asks; the "hand" is a
 * skin-tone blob in the hand box. MediaPipe finds no hand in it, so the card
 * mode's live loop shows its "no hand" hint and never fills the ring: what
 * this scene exercises for real is the card-mode screen itself (slot, hint,
 * no auto-shutter) and, after a manual shot, the real card analysis turning
 * the photo back ("no hand"). Measured outcomes come from the
 * `/scan/easy/card-live-demo` route instead.
 */
import type { Page } from "@playwright/test";

export interface CardSceneOptions {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** The part of the frame a 390x844 screen shows (object-fit: cover), px. */
  readonly visible: { readonly x: number; readonly width: number };
  /** px per mm at the table. */
  readonly scale: number;
  /** The card's centre, as a fraction of the visible view (G-M2 slot centre for a right hand). */
  readonly cardCentre: { readonly x: number; readonly y: number };
}

export const ID1_MM = { long: 85.6, short: 53.98, radius: 3.18 } as const;

export async function buildCardScenePng(
  page: Page,
  o: CardSceneOptions,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ o, card }) => {
      const canvas = document.createElement("canvas");
      canvas.width = o.canvasWidth;
      canvas.height = o.canvasHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#2b2b2e";
      ctx.fillRect(0, 0, o.canvasWidth, o.canvasHeight);
      const vx = (f: number) => o.visible.x + f * o.visible.width;
      const vy = (f: number) => f * o.canvasHeight;

      // A skin-tone "hand": palm and five fingers, in the hand box.
      ctx.fillStyle = "#d9a68c";
      const palmCx = vx(0.35);
      const palmCy = vy(0.6);
      ctx.beginPath();
      ctx.ellipse(palmCx, palmCy, vx(0.5) - vx(0.35), vy(0.12), 0, 0, 7);
      ctx.fill();
      const finger = (dx: number, top: number, w: number) => {
        ctx.beginPath();
        ctx.roundRect(
          vx(0.35 + dx) - w / 2,
          vy(top),
          w,
          palmCy - vy(top),
          w / 2,
        );
        ctx.fill();
      };
      const fw = (vx(0.5) - vx(0.35)) / 2.4;
      finger(-0.12, 0.3, fw); // index side ... pinky side at +x (right hand, palm down)
      finger(-0.04, 0.22, fw);
      finger(0.04, 0.25, fw);
      finger(0.11, 0.33, fw * 0.9);
      ctx.beginPath();
      ctx.ellipse(vx(0.18), vy(0.6), fw * 0.6, vy(0.08), -0.6, 0, 7);
      ctx.fill();
      // The wrist, running off the bottom.
      ctx.fillRect(
        palmCx - fw * 2.2,
        palmCy,
        fw * 4.4,
        o.canvasHeight - palmCy,
      );

      // The card, upright (long side vertical), light, in the slot.
      const w = card.short * o.scale;
      const h = card.long * o.scale;
      const cx = vx(o.cardCentre.x);
      const cy = vy(o.cardCentre.y);
      ctx.fillStyle = "#f2f2ee";
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, card.radius * o.scale);
      ctx.fill();
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { o, card: ID1_MM },
  );
  return Buffer.from(base64, "base64");
}
