/**
 * Reads drawn geometry back out of a PDF that Chromium produced (`page.pdf`),
 * in millimetres from the page's top-left corner, so a test can measure what a
 * printer would put on the paper. NOT a test file.
 *
 * It understands exactly what Chromium's Skia/PDF backend writes for an inline
 * SVG: Flate-compressed content streams, `q`/`Q`, `cm`, filled `re` rectangles
 * (`f`) and stroked `m`/`l` lines (`S`). Anything else (text, clips, dashes) is
 * skipped. No PDF library: the repo has none, and this needs only that much.
 */
import { inflateSync } from "node:zlib";

export const PT_PER_MM = 72 / 25.4;

export interface PdfRect {
  readonly kind: "rect";
  /** Top-left corner and size, in mm from the page's top-left. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Fill colour, 0 to 1 per channel. */
  readonly fill: readonly [number, number, number];
}

export interface PdfLine {
  readonly kind: "line";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly length: number;
}

export interface PdfGeometry {
  /** Number of `/Type /Page` objects (not `/Pages`). */
  readonly pageCount: number;
  /** First page's size in mm. */
  readonly pageMm: { readonly width: number; readonly height: number };
  readonly rects: readonly PdfRect[];
  readonly lines: readonly PdfLine[];
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `a` applied first, then `b` (PDF's `cm` order: new = m x old). */
function multiply(m: Matrix, old: Matrix): Matrix {
  return [
    m[0] * old[0] + m[1] * old[2],
    m[0] * old[1] + m[1] * old[3],
    m[2] * old[0] + m[3] * old[2],
    m[2] * old[1] + m[3] * old[3],
    m[4] * old[0] + m[5] * old[2] + old[4],
    m[4] * old[1] + m[5] * old[3] + old[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function flateStreams(pdf: Buffer): string[] {
  const text = pdf.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    try {
      out.push(inflateSync(pdf.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a Flate stream (an image, a font): nothing to read.
    }
  }
  return out;
}

export function readPdfGeometry(pdf: Buffer): PdfGeometry {
  const text = pdf.toString("latin1");
  const pageCount = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  const box =
    /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(
      text,
    );
  if (!box) throw new Error("No /MediaBox in the PDF.");
  const widthPt = Number(box[3]) - Number(box[1]);
  const heightPt = Number(box[4]) - Number(box[2]);

  const rects: PdfRect[] = [];
  const lines: PdfLine[] = [];
  const mm = (pt: number) => pt / PT_PER_MM;

  for (const stream of flateStreams(pdf)) {
    if (!/\bcm\b/.test(stream)) continue;
    let ctm: Matrix = IDENTITY;
    const stack: { ctm: Matrix; fill: [number, number, number] }[] = [];
    let fill: [number, number, number] = [0, 0, 0];
    let pendingRects: [number, number, number, number][] = [];
    let path: [number, number][] = [];
    const nums: number[] = [];

    for (const token of stream.split(/\s+/)) {
      if (token === "") continue;
      const n = Number(token);
      if (!Number.isNaN(n) && /^[-+.\d]/.test(token)) {
        nums.push(n);
        continue;
      }
      switch (token) {
        case "q":
          stack.push({ ctm, fill: [...fill] });
          break;
        case "Q": {
          const top = stack.pop();
          if (top) {
            ctm = top.ctm;
            fill = top.fill;
          }
          break;
        }
        case "cm":
          if (nums.length >= 6)
            ctm = multiply(nums.slice(-6) as unknown as Matrix, ctm);
          break;
        case "rg":
          if (nums.length >= 3)
            fill = nums.slice(-3) as [number, number, number];
          break;
        case "re": {
          const [x, y, w, h] = nums.slice(-4) as [
            number,
            number,
            number,
            number,
          ];
          pendingRects.push([x, y, w, h]);
          break;
        }
        case "m":
          path = [apply(ctm, nums[nums.length - 2]!, nums[nums.length - 1]!)];
          break;
        case "l":
          path.push(apply(ctm, nums[nums.length - 2]!, nums[nums.length - 1]!));
          break;
        case "f":
        case "f*":
        case "B":
        case "B*": {
          for (const [x, y, w, h] of pendingRects) {
            const [ax, ay] = apply(ctm, x, y);
            const [bx, by] = apply(ctm, x + w, y + h);
            rects.push({
              kind: "rect",
              x: mm(Math.min(ax, bx)),
              y: mm(heightPt - Math.max(ay, by)),
              w: mm(Math.abs(bx - ax)),
              h: mm(Math.abs(by - ay)),
              fill: [...fill],
            });
          }
          pendingRects = [];
          path = [];
          break;
        }
        case "S":
        case "s": {
          if (path.length === 2) {
            const [[x1, y1], [x2, y2]] = path as [
              [number, number],
              [number, number],
            ];
            lines.push({
              kind: "line",
              x1: mm(x1),
              y1: mm(heightPt - y1),
              x2: mm(x2),
              y2: mm(heightPt - y2),
              length: mm(Math.hypot(x2 - x1, y2 - y1)),
            });
          }
          path = [];
          pendingRects = [];
          break;
        }
        case "n":
          pendingRects = [];
          path = [];
          break;
        default:
          break;
      }
      nums.length = 0;
    }
  }
  return {
    pageCount,
    pageMm: { width: mm(widthPt), height: mm(heightPt) },
    rects,
    lines,
  };
}
