/**
 * Scan S2 (V3.2, 2026-10-21, candidate): the words for where the paper
 * detector stopped, on both paths. Live: the cue line, through the S1
 * debounce (the same stage two samples in a row before it is shown). After a
 * photo: `PAPER_NOT_FOUND` with the stage as `detail`, its English `message`
 * the same copy the zh-TW screen reads from. Every stage has both languages,
 * and the local attempt log keeps the stage as one of the six values.
 */
import { describe, expect, it } from "vitest";
import {
  PAPER_DETECTION_STAGES,
  PAPER_STAGE_COPY_KEYS,
  paperStageLines,
  type PaperDetectionStage,
} from "../../src/client/paper/detectionStage";
import { en, zhTW, paperStageCopy } from "../../src/lib/copy/paper-stage";
import {
  cueCodeForPaperStage,
  cueMessage,
  easyCueText,
  paperGateReason,
  pickCue,
  type CueCode,
  type CueInput,
} from "../../src/client/camera/cues";
import {
  advanceCueDebounce,
  INITIAL_CUE_DEBOUNCE_STATE,
  type CueDebounceState,
} from "../../src/client/camera/cueDebounce";
import { checkPaperFound } from "../../src/client/photo/gates";
import { issueText } from "../../src/client/photo/issueText";
import { scanIssuesCopy } from "../../src/lib/copy/scan-issues";
import {
  describeAttempt,
  sanitizeAttempt,
} from "../../src/client/camera/attemptLog";
import type { Locale } from "../../src/lib/contracts/locale";

const LOCALES: readonly Locale[] = ["zh-TW", "en"];
/** The four stages that name a step, and so say what may be wrong. */
const NAMED: readonly PaperDetectionStage[] = [
  "no_bright_region",
  "region_split",
  "aspect_mismatch",
  "too_small",
];

describe("paper-stage copy: zh-TW and en paired, 100 %", () => {
  it("every stage has a key, and both tables have the same keys", () => {
    expect(Object.keys(PAPER_STAGE_COPY_KEYS).sort()).toEqual(
      [...PAPER_DETECTION_STAGES].sort(),
    );
    expect(Object.keys(zhTW).sort()).toEqual(Object.keys(en).sort());
    expect(new Set(Object.values(PAPER_STAGE_COPY_KEYS)).size).toBe(
      PAPER_DETECTION_STAGES.length,
    );
  });

  it.each(PAPER_DETECTION_STAGES)(
    "%s: a live line and a retake sentence in both languages",
    (stage) => {
      for (const locale of LOCALES) {
        const lines = paperStageLines(stage, locale);
        expect(lines.live.trim().length).toBeGreaterThan(0);
        expect(lines.retake.trim().length).toBeGreaterThan(0);
      }
      // The two languages are different strings (nothing left untranslated).
      expect(paperStageLines(stage, "zh-TW").retake).not.toBe(
        paperStageLines(stage, "en").retake,
      );
    },
  );

  it.each(NAMED)("%s: says what MAY be wrong, never as a fact", (stage) => {
    expect(paperStageLines(stage, "zh-TW").live).toContain("可能");
    expect(paperStageLines(stage, "zh-TW").retake).toContain("可能");
    expect(paperStageLines(stage, "en").live).toMatch(/\bmay\b/i);
    expect(paperStageLines(stage, "en").retake).toMatch(/\bmay\b/i);
  });

  it("no health or medical words, and no number but the paper name A4", () => {
    const all = JSON.stringify([zhTW, en]);
    expect(all).not.toMatch(
      /健康|醫|疼痛|傷害|治療|腕隧道|health|medical|pain|injur|treat/i,
    );
    expect(all.replace(/A4/g, "")).not.toMatch(/[0-9]/);
  });

  it("unknown keeps today's plain line in both languages", () => {
    expect(paperStageLines("unknown", "zh-TW").retake).toBe(
      scanIssuesCopy("zh-TW").paperNotFound,
    );
    expect(paperStageLines("unknown", "en").retake).toBe(
      scanIssuesCopy("en").paperNotFound,
    );
  });

  it("the picker picks by locale", () => {
    expect(paperStageCopy("zh-TW")).toBe(zhTW);
    expect(paperStageCopy("en")).toBe(en);
  });
});

describe("after a photo: PAPER_NOT_FOUND names the stage", () => {
  it.each(PAPER_DETECTION_STAGES)("%s", (stage) => {
    const failure = checkPaperFound(false, stage);
    expect(failure).not.toBeNull();
    expect(failure!.code).toBe("PAPER_NOT_FOUND");
    expect(failure!.detail).toEqual({ kind: "paperStage", stage });
    // English: the message, which is the copy's line.
    expect(failure!.message).toBe(paperStageLines(stage, "en").retake);
    expect(issueText(failure!, "en")).toBe(paperStageLines(stage, "en").retake);
    // zh-TW: from the detail, the same copy.
    expect(issueText(failure!, "zh-TW")).toBe(
      paperStageLines(stage, "zh-TW").retake,
    );
  });

  it("a found sheet never fails, stage or not", () => {
    expect(checkPaperFound(true, "region_split")).toBeNull();
    expect(checkPaperFound(true)).toBeNull();
  });

  it("without a stage (an older record, another caller) the failure and its words are unchanged", () => {
    const plain = checkPaperFound(false);
    expect(plain).toEqual({
      code: "PAPER_NOT_FOUND",
      message: scanIssuesCopy("en").paperNotFound,
    });
    expect(issueText(plain!, "zh-TW")).toBe(
      scanIssuesCopy("zh-TW").paperNotFound,
    );
  });
});

const NO_SHEET: CueInput = {
  cornersSeen: 0,
  quad: null,
  frameWidth: 640,
  meanLuma: 120,
  clippedFraction: 0,
  steady: false,
  sharpEnough: true,
  msSinceLastDetection: 0,
};

describe("live preview: the stage's cue", () => {
  it.each(NAMED)("%s has its own cue, in the live words", (stage) => {
    const code = cueCodeForPaperStage(stage);
    expect(code).not.toBeNull();
    for (const locale of LOCALES) {
      const cue = pickCue(
        { ...NO_SHEET, paperStage: stage },
        "paper-edge",
        locale,
      );
      expect(cue.code).toBe(code);
      expect(cue.allPass).toBe(false);
      expect(cue.message).toBe(paperStageLines(stage, locale).live);
      expect(cueMessage(code!, "paper-edge", locale)).toBe(cue.message);
      expect(easyCueText(cue, { tapToFocus: false, locale })).toBe(
        paperStageLines(stage, locale).live,
      );
    }
  });

  it("exception, unknown and no stage keep the existing no-paper cues", () => {
    for (const paperStage of [
      "exception",
      "unknown",
      null,
      undefined,
    ] as const) {
      expect(cueCodeForPaperStage(paperStage)).toBeNull();
      expect(
        pickCue({ ...NO_SHEET, paperStage }, "paper-edge", "en").code,
      ).toBe("no-corners");
      expect(
        pickCue(
          { ...NO_SHEET, paperStage, msSinceLastDetection: 60_000 },
          "paper-edge",
          "en",
        ).code,
      ).toBe("place-paper");
    }
  });

  it("a stage never overrides corners that were seen", () => {
    expect(
      pickCue(
        { ...NO_SHEET, cornersSeen: 2, paperStage: "too_small" },
        "paper-edge",
        "en",
      ).code,
    ).toBe("some-corners");
  });

  it("the four stage cues are one debounce reason", () => {
    for (const stage of NAMED) {
      const code = cueCodeForPaperStage(stage)!;
      expect(paperGateReason(code)).toBe("paper-stage");
    }
    expect(paperGateReason("no-corners")).toBeNull();
  });

  it("before a sheet was ever seen, no stage cue: the cues from before S2", () => {
    for (const stage of NAMED) {
      for (const [ms, code] of [
        [0, "no-corners"],
        [2001, "place-paper"],
      ] as const) {
        expect(
          pickCue(
            {
              ...NO_SHEET,
              paperStage: stage,
              sheetSeenYet: false,
              msSinceLastDetection: ms,
            },
            "paper-edge",
            "en",
          ).code,
        ).toBe(code);
      }
    }
  });

  it("no sheet ever, light ok, past the timeout: place-paper, not 'may be too dark'", () => {
    const input: CueInput = {
      ...NO_SHEET,
      meanLuma: 120,
      clippedFraction: 0,
      paperStage: "no_bright_region",
      sheetSeenYet: false,
      msSinceLastDetection: 2001,
    };
    expect(pickCue(input, "paper-edge", "en").code).toBe("place-paper");
    expect(pickCue(input, "paper-edge", "zh-TW").code).toBe("place-paper");
  });

  it("after the timeout with a sheet seen: each named stage's code (candidate order)", () => {
    const expected: Record<string, CueCode> = {
      // Light ok: the sheet is most likely gone, so the timeout cue wins.
      no_bright_region: "place-paper",
      region_split: "stage-region-split",
      aspect_mismatch: "stage-aspect-mismatch",
      too_small: "stage-too-small",
    };
    for (const stage of NAMED) {
      expect(
        pickCue(
          {
            ...NO_SHEET,
            paperStage: stage,
            sheetSeenYet: true,
            msSinceLastDetection: 2001,
          },
          "paper-edge",
          "en",
        ).code,
      ).toBe(expected[stage]);
    }
  });

  it("no bright region in dim light keeps its cue after the timeout", () => {
    expect(
      pickCue(
        {
          ...NO_SHEET,
          meanLuma: 30,
          paperStage: "no_bright_region",
          sheetSeenYet: true,
          msSinceLastDetection: 2001,
        },
        "paper-edge",
        "en",
      ).code,
    ).toBe("stage-no-bright-region");
  });

  it("before the timeout with a sheet seen, every named stage has its cue", () => {
    for (const stage of NAMED) {
      expect(
        pickCue(
          { ...NO_SHEET, paperStage: stage, sheetSeenYet: true },
          "paper-edge",
          "en",
        ).code,
      ).toBe(cueCodeForPaperStage(stage));
    }
  });
});

describe("live preview: the S1 debounce (two in a row) holds for stage cues", () => {
  const step = (state: CueDebounceState, code: CueCode, at: number) =>
    advanceCueDebounce(state, code, at, {
      leavePerfectSamples: 3,
      minTextChangeMs: 0,
      confirmSamples: 2,
    });

  it("one sample of a stage does not change the words; the second does", () => {
    let s = step(INITIAL_CUE_DEBOUNCE_STATE, "no-corners", 0);
    expect(s.shown).toBe("no-corners");
    s = step(s, "stage-region-split", 100);
    expect(s.shown).toBe("no-corners");
    s = step(s, "stage-region-split", 200);
    expect(s.shown).toBe("stage-region-split");
  });

  it("stages that keep changing never reach the screen", () => {
    let s = step(INITIAL_CUE_DEBOUNCE_STATE, "no-corners", 0);
    const flips: CueCode[] = [
      "stage-region-split",
      "stage-too-small",
      "stage-region-split",
      "stage-aspect-mismatch",
      "stage-no-bright-region",
    ];
    flips.forEach((code, i) => {
      s = step(s, code, 100 * (i + 1));
    });
    expect(s.shown).toBe("no-corners");
  });

  it("two stages that alternate do not keep 'perfect' on screen (default options)", () => {
    let s = advanceCueDebounce(INITIAL_CUE_DEBOUNCE_STATE, "perfect", 0);
    expect(s.shown).toBe("perfect");
    for (let i = 1; i <= 60; i++) {
      s = advanceCueDebounce(
        s,
        i % 2 ? "stage-too-small" : "stage-aspect-mismatch",
        200 * i,
      );
    }
    expect(s.shown).toBe("no-corners");
  });

  it.each([
    ["stage-too-small", "stage-region-split"],
    ["stage-no-bright-region", "stage-too-small"],
  ] as const)(
    "%s / %s alternating from 'perfect' or 'tilted' fall back to no-corners",
    (a, b) => {
      for (const start of ["perfect", "tilted"] as const) {
        let s = step(INITIAL_CUE_DEBOUNCE_STATE, start, 0);
        for (let i = 1; i <= 20; i++) s = step(s, i % 2 ? a : b, 1000 * i);
        expect(s.shown).toBe("no-corners");
      }
    },
  );

  it("one stage held steady after 'perfect' shows that stage", () => {
    let s = step(INITIAL_CUE_DEBOUNCE_STATE, "perfect", 0);
    for (let i = 1; i <= 4; i++) s = step(s, "stage-too-small", 1000 * i);
    expect(s.shown).toBe("stage-too-small");
  });
});

describe("attempt log: the stage as one of the six values", () => {
  const base = {
    v: 1,
    at: "2026-10-21T01:02:03.000Z",
    result: "error",
    errors: [{ code: "PAPER_NOT_FOUND", message: "x" }],
    paper: {
      cornersSeen: 0,
      minSideCoverage: 0,
      gateFailures: ["PAPER_NOT_FOUND"],
    },
  };

  it.each(PAPER_DETECTION_STAGES)("%s round-trips", (stage) => {
    const record = sanitizeAttempt({
      ...base,
      paper: { ...base.paper, failureStage: stage },
    });
    expect(record?.paper?.failureStage).toBe(stage);
    expect(sanitizeAttempt(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(describeAttempt(record!)).toContain(`stage ${stage}`);
  });

  it("anything else, and an older record, read back as null", () => {
    for (const failureStage of [
      "region split",
      "NONE",
      3,
      { a: 1 },
      undefined,
    ]) {
      const record = sanitizeAttempt({
        ...base,
        paper: { ...base.paper, failureStage },
      });
      expect(record?.paper?.failureStage).toBeNull();
      expect(describeAttempt(record!)).not.toContain("stage ");
    }
  });
});
