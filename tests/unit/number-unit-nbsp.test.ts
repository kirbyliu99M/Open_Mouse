import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountView } from "../../src/app/account/AccountView";
import type { AccountScan } from "../../src/server/account/repo";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import { en as easyEn, zhTW as easyZh } from "../../src/lib/copy/easy-scan";

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
    calibrationMethod: "printed-sheet",
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

describe("/account's 我的手 rows", () => {
  const html = renderToStaticMarkup(
    createElement(AccountView, { scans: [scan(190, 108, 84)] }),
  );
  const values = [
    ...html.matchAll(/<dd class="profile-fact">([^<]*)<\/dd>/g),
  ].map((m) => m[1]);

  it("has hand length and palm width, each as a number, a no-break space and cm", () => {
    expect(values).toEqual([`19.0${NBSP}cm`, `8.4${NBSP}cm`]);
  });

  it("never joins them with a plain space", () => {
    for (const value of values) expect(value).not.toMatch(/\d cm/);
  });
});

describe("the results page's typed-length note", () => {
  it("joins the entered length and mm with a no-break space", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: FIXTURES["high-confidence"],
        language: "en",
        enteredLengthMm: 186,
      }),
    );
    expect(html).toContain(`(186${NBSP}mm). Measured without paper.`);
    expect(html).not.toMatch(/186 mm/);
  });

  it("does the same in zh-TW", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: FIXTURES["high-confidence"],
        language: "zh-TW",
        enteredLengthMm: 186,
      }),
    );
    expect(html).toContain(`（186${NBSP}mm）`);
    expect(html).not.toMatch(/186 mm/);
  });
});

describe("the easy-scan camera screen (its words are in src/lib/copy/easy-scan.ts; it needs a live camera)", () => {
  const source = read("src/client/camera/EasyScanCamera.tsx");

  it("joins the typed length in the chip, 'NNN mm entered', with a no-break space", () => {
    expect(source).toContain("easy.lengthChip(");
    for (const table of [easyEn, easyZh])
      expect(table.lengthChip("190")).toContain(`190${NBSP}mm`);
    expect(easyEn.lengthChip("190")).toBe(`190${NBSP}mm entered`);
  });

  it("does the same in the 'you entered' disclosure and the length hint", () => {
    expect(source).toContain("easy.disclosureBased(");
    expect(source).toContain("easy.lengthHint(");
    for (const table of [easyEn, easyZh]) {
      expect(table.disclosureBased("190")).toContain(`190${NBSP}mm`);
      expect(table.lengthHint(135, 265)).toContain(`186${NBSP}mm`);
      expect(table.lengthHint(135, 265)).toContain(`18.6${NBSP}cm`);
    }
  });
});
