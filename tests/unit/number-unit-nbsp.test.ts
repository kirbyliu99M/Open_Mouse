import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountView } from "../../src/app/account/AccountView";
import type { AccountScan } from "../../src/server/account/repo";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";

/**
 * A number and its unit are joined by a no-break space (U+00A0), so a wide
 * font cannot wrap "186 mm" onto two lines. Two of the places that do it
 * cannot be reached by the font-independent browser check in
 * tests/e2e/number-unit-wrap.spec.ts (it needs a live camera, or a signed-in
 * account), so they are held here, without a browser and without a font: by
 * rendering the component, or, for the camera screen, by reading its source.
 */
const NBSP = String.fromCharCode(0xa0);
const read = (path: string) => readFileSync(path, "utf8");

const scan = (hand: number, palmLength: number, palmWidth: number) =>
  ({
    scanId: "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d",
    createdAt: "2026-10-04T08:00:00.000Z",
    hand: "right",
    gripStyleStated: null,
    palmThicknessStated: null,
    measurements: {
      handLengthMm: hand,
      palmLengthMm: palmLength,
      palmWidthMm: palmWidth,
      thumbLengthMm: null,
      indexLengthMm: null,
      middleLengthMm: null,
      ringLengthMm: null,
      pinkyLengthMm: null,
      palmThicknessMm: null,
      knuckleHeightMm: null,
      gripApertureMm: null,
      thumbAngleDeg: null,
    },
  }) satisfies AccountScan;

describe("/account's scan card", () => {
  const html = renderToStaticMarkup(
    createElement(AccountView, { scans: [scan(190, 108, 84)] }),
  );
  const values = [...html.matchAll(/<dd>([^<]*)<\/dd>/g)].map((m) => m[1]);

  it("has the three measurements, each as a number, a no-break space and mm", () => {
    expect(values).toEqual([`190${NBSP}mm`, `108${NBSP}mm`, `84${NBSP}mm`]);
  });

  it("never joins them with a plain space", () => {
    for (const value of values) expect(value).not.toMatch(/\d mm/);
  });
});

describe("the results page's typed-length note", () => {
  it("joins the entered length and mm with a no-break space", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: FIXTURES["high-confidence"],
        enteredLengthMm: 186,
      }),
    );
    expect(html).toContain(`(186${NBSP}mm). Measured without paper.`);
    expect(html).not.toMatch(/186 mm/);
  });
});

describe("the easy-scan camera screen (read from its source: it needs a live camera)", () => {
  const source = read("src/client/camera/EasyScanCamera.tsx");

  it("joins the typed length in the chip, 'NNN mm entered', with a no-break space", () => {
    expect(source).toContain("{userLengthMm}&nbsp;mm entered");
    expect(source).not.toMatch(/\{userLengthMm\} mm/);
  });

  it("does the same in the 'you entered' disclosure and the length hint", () => {
    expect(source).toContain(
      "{result.submission.calibration.referenceMm}&nbsp;mm)",
    );
    expect(source).toContain("18.6&nbsp;cm = 186&nbsp;mm.");
    expect(source).not.toMatch(/referenceMm\} mm\)/);
  });
});
