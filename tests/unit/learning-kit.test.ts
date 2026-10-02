import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import {
  GESTURES,
  GESTURE_CODES,
  KIT_V1_VERSION,
  buildSequence,
  formatParticipantId,
  kitCodeToken,
  kitCodeUrl,
  parseKitCode,
  parseKitToken,
  shotsPerHand,
  sortPhotos,
  type IdentifiedPhoto,
  type KitCode,
} from "../../src/lib/learning/kit";
import {
  QR_QUIET_MODULES,
  qrDarkRuns,
  qrMatrix,
} from "../../src/lib/learning/qr";
import {
  KIT_PAGE_HEIGHT_MM,
  KIT_PAGE_WIDTH_MM,
  computeSideKitLayout,
  computeTopDownKitLayout,
  heightAboveTableMm,
  type Rect,
} from "../../src/lib/learning/layout";
import { computeSheetLayout } from "../../src/client/sheet/layout";

const gestureCode = (
  gesture: (typeof GESTURE_CODES)[number],
  hand: "right" | "left",
): KitCode => ({
  kind: "gesture",
  version: KIT_V1_VERSION,
  gesture,
  hand,
});
const participantCode = (participant: string): KitCode => ({
  kind: "participant",
  version: KIT_V1_VERSION,
  participant,
});

const ALL_CODES: KitCode[] = [
  ...GESTURE_CODES.flatMap((g) => [
    gestureCode(g, "right"),
    gestureCode(g, "left"),
  ]),
  participantCode("P001"),
  participantCode("P999"),
];

describe("gesture catalogue", () => {
  it("lists every code once, in capture order", () => {
    expect(GESTURES.map((g) => g.code)).toEqual([...GESTURE_CODES]);
  });

  it("puts every flap-flat pose before every flap-up pose", () => {
    const flaps = GESTURES.map((g) => g.flap);
    expect(flaps.indexOf("up")).toBeGreaterThan(flaps.lastIndexOf("flat"));
    for (const g of GESTURES) expect(g.flap === "up").toBe(g.camera === "side");
  });

  it("takes five repeats of the M2 gate pose and at least three of every other", () => {
    expect(GESTURES[0]?.shots).toBe(5);
    for (const g of GESTURES.slice(1))
      expect(g.shots).toBeGreaterThanOrEqual(3);
    expect(shotsPerHand()).toBe(23);
  });

  it("makes no medical claims", () => {
    const text = GESTURES.flatMap((g) => [g.name, g.yields, ...g.steps]).join(
      " ",
    );
    expect(text).not.toMatch(
      /diagnos|carpal|tunnel|injur|treat|prevent|cure|RSI|pain/i,
    );
  });
});

describe("QR payloads", () => {
  it("formats participant ids without names", () => {
    expect(formatParticipantId(7)).toBe("P007");
    expect(formatParticipantId(999)).toBe("P999");
    expect(() => formatParticipantId(0)).toThrow();
    expect(() => formatParticipantId(1000)).toThrow();
    expect(() => formatParticipantId(1.5)).toThrow();
  });

  it.each(ALL_CODES)("round-trips %o through its URL and its token", (code) => {
    expect(parseKitCode(kitCodeUrl(code))).toEqual(code);
    expect(parseKitCode(kitCodeToken(code))).toEqual(code);
  });

  it("uses short tokens", () => {
    expect(kitCodeToken(gestureCode("G03", "right"))).toBe("G03R");
    expect(kitCodeToken(gestureCode("G07", "left"))).toBe("G07L");
    expect(kitCodeUrl(gestureCode("G03", "right"))).toBe(
      "https://open-mouse.vercel.app/l/v1/G03R",
    );
  });

  it("accepts any host, a trailing slash, a query and lower case", () => {
    expect(parseKitCode("http://127.0.0.1:3217/l/v1/g04l/?x=1#top")).toEqual(
      gestureCode("G04", "left"),
    );
    expect(parseKitCode("  p042 ")).toEqual(participantCode("P042"));
  });

  it("keeps the version from the URL", () => {
    expect(parseKitCode("https://open-mouse.vercel.app/l/v2/G01R")).toEqual({
      kind: "gesture",
      version: 2,
      gesture: "G01",
      hand: "right",
    });
  });

  it.each([
    "",
    "hello",
    "G08R",
    "G01X",
    "P000",
    "P1234",
    "https://example.com/menu",
    "https://open-mouse.vercel.app/l/v0/G01R",
    "https://open-mouse.vercel.app/l/v1/G09R",
    "https://open-mouse.vercel.app/results/G01R",
  ])("rejects %j", (text) => {
    expect(parseKitCode(text)).toBeNull();
  });

  it("parses bare tokens at an explicit version", () => {
    expect(parseKitToken("G02R", 3)).toEqual({
      kind: "gesture",
      version: 3,
      gesture: "G02",
      hand: "right",
    });
  });
});

/** Render a QR matrix to RGBA the way a clean photo would see it. */
function renderQr(text: string, pxPerModule = 6) {
  const m = qrMatrix(text);
  const side = (m.size + 2 * QR_QUIET_MODULES) * pxPerModule;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  m.dark.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < pxPerModule; dy++)
        for (let dx = 0; dx < pxPerModule; dx++) {
          const px = (x + QR_QUIET_MODULES) * pxPerModule + dx;
          const py = (y + QR_QUIET_MODULES) * pxPerModule + dy;
          const i = (py * side + px) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }),
  );
  return { data, side };
}

describe("printed QR codes", () => {
  it.each(ALL_CODES.map((c) => kitCodeUrl(c)))(
    "%s decodes back to itself",
    (url) => {
      const { data, side } = renderQr(url);
      expect(jsQR(data, side, side)?.data).toBe(url);
    },
  );

  it("stays at version 3 (29 modules) so a 24 mm code has ≥ 0.6 mm modules", () => {
    for (const code of ALL_CODES) {
      const m = qrMatrix(kitCodeUrl(code));
      expect(m.size).toBe(29);
      expect(24 / (m.size + 2 * QR_QUIET_MODULES)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("draws exactly the dark modules as horizontal runs", () => {
    const m = qrMatrix(kitCodeUrl(gestureCode("G05", "left")));
    const rebuilt = m.dark.map((row) => row.map(() => false));
    for (const run of qrDarkRuns(m))
      for (let x = run.x; x < run.x + run.w; x++) {
        expect(rebuilt[run.y]![x]).toBe(false); // runs never overlap
        rebuilt[run.y]![x] = true;
      }
    expect(rebuilt).toEqual(m.dark);
  });
});

describe("capture sequence", () => {
  it("covers every pose and shot for each hand, right hand first", () => {
    const steps = buildSequence();
    expect(steps).toHaveLength(2 * shotsPerHand());
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i + 1));
    expect(steps[0]).toMatchObject({ hand: "right", shot: 1, shots: 5 });
    expect(steps[0]?.gesture.code).toBe("G01");
    expect(steps.at(-1)).toMatchObject({ hand: "left", shot: 3 });
    expect(steps.at(-1)?.gesture.code).toBe("G07");
  });

  it("folds the flap once per hand", () => {
    for (const hand of ["right", "left"] as const) {
      const flaps = buildSequence([hand]).map((s) => s.gesture.flap);
      const changes = flaps.filter((f, i) => i > 0 && f !== flaps[i - 1]);
      expect(changes).toEqual(["up"]);
    }
  });

  it("drops duplicate hands and supports one-hand sessions", () => {
    expect(buildSequence(["left", "left"])).toHaveLength(shotsPerHand());
    expect(buildSequence(["left"])[0]?.hand).toBe("left");
  });
});

describe("sorting a folder of photos", () => {
  const photo = (
    file: string,
    takenAt: number,
    code: KitCode | null,
    detectedHand?: "left" | "right" | null,
  ): IdentifiedPhoto => ({ file, takenAt, code, detectedHand });

  it("files pose photos under the latest slate, numbering shots per pose and hand", () => {
    const { photos } = sortPhotos([
      photo("IMG_1.JPG", 1, participantCode("P007")),
      photo("IMG_2.JPG", 2, gestureCode("G01", "right"), "right"),
      photo("IMG_3.JPG", 3, gestureCode("G01", "right"), "right"),
      photo("IMG_4.jpeg", 4, gestureCode("G02", "right"), "right"),
      photo("IMG_5.JPG", 5, participantCode("P008")),
      photo("IMG_6.JPG", 6, gestureCode("G01", "right"), null),
    ]);
    expect(photos.map((p) => [p.status, p.destination])).toEqual([
      ["slate", "P007/slate.jpg"],
      ["ok", "P007/G01R/1.jpg"],
      ["ok", "P007/G01R/2.jpg"],
      ["ok", "P007/G02R/1.jpeg"],
      ["slate", "P008/slate.jpg"],
      ["ok", "P008/G01R/1.jpg"],
    ]);
  });

  it("orders by capture time, not by input order", () => {
    const { photos } = sortPhotos([
      photo("b.jpg", 20, gestureCode("G01", "left")),
      photo("a.jpg", 10, participantCode("P001")),
    ]);
    expect(photos.map((p) => p.file)).toEqual(["a.jpg", "b.jpg"]);
    expect(photos[1]?.destination).toBe("P001/G01L/1.jpg");
  });

  it("never files a photo it cannot identify", () => {
    const { photos } = sortPhotos([
      photo("early.jpg", 1, gestureCode("G01", "right")),
      photo("slate.jpg", 2, participantCode("P002")),
      photo("blurry.jpg", 3, null),
      photo("old-kit.jpg", 4, { ...gestureCode("G01", "right"), version: 2 }),
    ]);
    expect(photos.map((p) => [p.file, p.status, p.destination])).toEqual([
      ["early.jpg", "no-participant", null],
      ["slate.jpg", "slate", "P002/slate.jpg"],
      ["blurry.jpg", "no-code", null],
      ["old-kit.jpg", "version-mismatch", null],
    ]);
  });

  it("files but flags a photo whose detected hand contradicts its sheet", () => {
    const { photos } = sortPhotos([
      photo("s.jpg", 1, participantCode("P003")),
      photo("x.jpg", 2, gestureCode("G04", "left"), "right"),
    ]);
    expect(photos[1]).toMatchObject({
      status: "hand-mismatch",
      destination: "P003/G04L/1.jpg",
    });
  });

  it("reports coverage for each hand a participant used", () => {
    const { coverage } = sortPhotos([
      photo("s.jpg", 1, participantCode("P004")),
      photo("1.jpg", 2, gestureCode("G01", "right")),
      photo("2.jpg", 3, gestureCode("G01", "right")),
      photo("3.jpg", 4, gestureCode("G06", "right")),
    ]);
    expect(coverage).toHaveLength(GESTURES.length);
    expect(coverage.find((r) => r.gesture === "G01")).toMatchObject({
      participant: "P004",
      hand: "right",
      expected: 5,
      got: 2,
    });
    expect(coverage.find((r) => r.gesture === "G06")?.got).toBe(1);
    expect(coverage.find((r) => r.gesture === "G07")?.got).toBe(0);
    expect(coverage.every((r) => r.hand === "right")).toBe(true);
  });
});

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap &&
  b.x < a.x + a.w + gap &&
  a.y < b.y + b.h + gap &&
  b.y < a.y + a.h + gap;
const markerRect = (m: {
  corners: readonly { x: number; y: number }[];
}): Rect => ({
  x: m.corners[0]!.x,
  y: m.corners[0]!.y,
  w: m.corners[1]!.x - m.corners[0]!.x,
  h: m.corners[3]!.y - m.corners[0]!.y,
});

describe("kit page layouts", () => {
  it("keeps the product sheet's marker geometry on top-down pages", () => {
    expect(computeTopDownKitLayout().markers).toEqual(
      computeSheetLayout().markers,
    );
  });

  it.each([
    ["top-down", computeTopDownKitLayout()],
    ["side", computeSideKitLayout()],
  ] as const)(
    "%s page: QR codes, markers and title never touch",
    (_, layout) => {
      const boxes = [
        ...layout.qr,
        ...layout.markers.map(markerRect),
        layout.titleBox,
      ];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          expect(overlaps(boxes[i]!, boxes[j]!, 3)).toBe(false);
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(15);
        expect(b.x + b.w).toBeLessThanOrEqual(KIT_PAGE_WIDTH_MM - 15);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(KIT_PAGE_HEIGHT_MM);
      }
    },
  );

  it("top-down QR codes sit on the top flap, away from the hand", () => {
    const layout = computeTopDownKitLayout();
    expect(layout.qr).toHaveLength(2);
    for (const q of layout.qr) expect(q.y + q.h).toBeLessThan(layout.foldY);
  });

  it("side-page markers and QR stand clear of a hand up to 50 mm tall", () => {
    const layout = computeSideKitLayout();
    const lowestPrinted = Math.max(
      ...layout.qr.map((q) => q.y + q.h),
      ...layout.markers.map((m) => m.corners[3]!.y),
    );
    expect(heightAboveTableMm(lowestPrinted)).toBeGreaterThanOrEqual(55);
    expect(layout.markers.map((m) => m.id)).toEqual([4, 5]);
  });
});
