/**
 * The one-line note on the results page when the survey ratings moved the
 * target sizes (v3.1 consumers, Kirby 2026-10-20; the wording is a candidate,
 * 未拍板): shown only when the response's calibration block has a non-zero
 * shift, in both languages, with no number and no health claim.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import type { FitCalibration, FitResponse } from "../../src/lib/contracts/fit";
import type { Locale } from "../../src/lib/contracts/locale";
import { RESULTS_PAGE_COPY } from "../../src/lib/copy/results-page";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";

const render = (response: FitResponse, language: Locale) =>
  renderToStaticMarkup(createElement(ResultsView, { response, language }));

const dim = (shiftMm: number) => ({
  shiftMm,
  answers: shiftMm === 0 ? 0 : 2,
  conflict: false,
});
const calibration = (
  length: number,
  width = 0,
  height = 0,
): FitCalibration => ({
  referencesUsed: 2,
  dims: { length: dim(length), gripWidth: dim(width), height: dim(height) },
});
const withCalibration = (c: FitCalibration | undefined): FitResponse => ({
  ...FIXTURES["many-results"],
  ...(c ? { calibration: c } : {}),
});

describe("the calibration note on the results page", () => {
  it("the zh-TW draft reads as Kirby's wording, and the English one says the same", () => {
    expect(RESULTS_PAGE_COPY["zh-TW"].calibrationNotice).toBe(
      "已參考你在問卷評過的滑鼠微調尺寸",
    );
    expect(RESULTS_PAGE_COPY.en.calibrationNotice).toMatch(/survey/i);
  });

  it.each(["zh-TW", "en"] as const)(
    "is shown when a target moved (%s)",
    (language) => {
      const notice = RESULTS_PAGE_COPY[language].calibrationNotice;
      expect(render(withCalibration(calibration(1.5)), language)).toContain(
        notice,
      );
      // Any one dimension is enough.
      expect(
        render(withCalibration(calibration(0, 0, -2)), language),
      ).toContain(notice);
    },
  );

  it.each(["zh-TW", "en"] as const)(
    "is not shown with no calibration block, or when every shift is 0 (%s)",
    (language) => {
      const notice = RESULTS_PAGE_COPY[language].calibrationNotice;
      expect(render(withCalibration(undefined), language)).not.toContain(
        notice,
      );
      expect(render(withCalibration(calibration(0)), language)).not.toContain(
        notice,
      );
    },
  );

  it("has no digit and no medical claim, in either language", () => {
    for (const language of ["zh-TW", "en"] as const) {
      const text = RESULTS_PAGE_COPY[language].calibrationNotice;
      expect(text).not.toMatch(/\d/);
      expect(findMedicalClaimTerm(text)).toBeNull();
    }
  });
});
