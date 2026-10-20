import { describe, expect, it } from "vitest";
import {
  cameraCuesCopy,
  en as cuesEn,
  zhTW as cuesZh,
} from "@/lib/copy/camera-cues";
import { en as easyEn, zhTW as easyZh } from "@/lib/copy/easy-scan";
import {
  scanCommonCopy,
  en as commonEn,
  zhTW as commonZh,
} from "@/lib/copy/scan-common";
import { en as issuesEn, zhTW as issuesZh } from "@/lib/copy/scan-issues";
import { en as sheetEn, zhTW as sheetZh } from "@/lib/copy/scan-sheet";
import {
  computeStatusChips,
  cueFromCode,
  cueMessage,
  easyCueText,
  easyHintText,
  pickCue,
  type CueCode,
  type CueInput,
} from "@/client/camera/cues";
import {
  handChipAccessibleName,
  handChipLabel,
} from "@/client/camera/handInference";
import { noPaperEntryLabel } from "@/client/camera/noPaperEntry";
import {
  checkCardScale,
  checkHandDetected,
  checkHandedness,
  checkHandInBounds,
  checkLandmarkConfidence,
  checkMarkers,
  checkPaperCornersSeen,
  checkPaperCurled,
  checkPaperEdgeCoverage,
  checkPaperFound,
  checkReprojectionError,
  checkSharpness,
} from "@/client/photo/gates";
import { issueText } from "@/client/photo/issueText";
import {
  describeDetectorLoad,
  describeDownload,
} from "@/client/photo/model-download";
import {
  checkUserLengthProportion,
  checkUserLengthStraightness,
  userLengthRangeMessage,
  userLengthRetakeMessage,
} from "@/client/photo/user-length";
import {
  measuredNumbersText,
  measuredSheetNumbers,
} from "@/client/photo/unverified-note";
import { DETECTOR_LOAD_FAILED_MESSAGE } from "@/client/photo/landmarks";
import { SUBMIT_ERROR_MESSAGES } from "@/client/scan/submitScan";
import { HEIC_RETAKE_MESSAGE } from "@/client/photo/decode";
import {
  PHOTO_PRIVACY_COPY,
  PHOTO_PRIVACY_COPY_THIS_DEVICE,
} from "@/components/privacy-copy";

const CJK = /[㐀-鿿]/;
// Characters that exist only in Simplified Chinese (a spot check, not a
// converter): any of these in a zh-TW string is a mistake.
const SIMPLIFIED = /[这个为过请说关开将选还让从对应].*?/u;
const SIMPLIFIED_ONLY = /[这个为过请说关开将选还让从对应样图线击测够点画]/u;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [];
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

const CODES: CueCode[] = [
  "place-paper",
  "no-corners",
  "some-corners",
  "tilted",
  "edge-covered",
  "edge-covered-top",
  "edge-covered-bottom",
  "edge-covered-left",
  "edge-covered-right",
  "paper-curled",
  "too-far",
  "too-close",
  "dark",
  "bright",
  "hold-still",
  "out-of-focus",
  "perfect",
];

const GOOD: CueInput = {
  cornersSeen: 4,
  quad: null,
  frameWidth: 640,
  meanLuma: 128,
  clippedFraction: 0,
  steady: true,
  sharpEnough: true,
  msSinceLastDetection: 0,
};

describe("zh-TW scan tables", () => {
  const tables = {
    cues: cuesZh,
    easy: easyZh,
    common: commonZh,
    issues: issuesZh,
    sheet: sheetZh,
  };
  for (const [name, table] of Object.entries(tables)) {
    it(`${name} has Chinese and no Simplified-only characters`, () => {
      const all = strings(table);
      expect(all.some((s) => CJK.test(s))).toBe(true);
      for (const s of all) expect(s).not.toMatch(SIMPLIFIED_ONLY);
    });
  }
  it("negative control: the Simplified check can fail", () => {
    expect(SIMPLIFIED_ONLY.test("请把相机对准")).toBe(true);
    expect(SIMPLIFIED.test("請把相機對準")).toBe(false);
  });
  it("has no empty zh-TW string", () => {
    for (const table of Object.values(tables))
      for (const s of strings(table)) expect(s.trim()).not.toBe("");
  });
});

describe("English stays byte-identical", () => {
  it("cue lines", () => {
    expect(cueMessage("place-paper", "paper-edge", "en")).toBe(
      "Place a blank sheet of paper on a darker surface",
    );
    expect(cueMessage("place-paper", "printed-sheet", "en")).toBe(
      "Place a blank sheet of paper on a darker surface".replaceAll(
        "paper",
        "sheet",
      ),
    );
    expect(cueMessage("some-corners", "paper-edge", "en")).toBe(
      "Move back so all four paper corners are in view",
    );
    expect(cueMessage("some-corners", "printed-sheet", "en")).toBe(
      "Move back so all four sheet corners are in view",
    );
    expect(cueFromCode("perfect", "paper-edge", "en").message).toBe(
      "Perfect — hold still",
    );
    expect(cuesEn.gotIt).toBe("Got it — hold still");
  });
  it("privacy sentences match the shared constants", () => {
    expect(commonEn.privacyPhone).toBe(PHOTO_PRIVACY_COPY);
    expect(commonEn.privacyDevice).toBe(PHOTO_PRIVACY_COPY_THIS_DEVICE);
    expect(commonEn.privacyAndCameraStays).toBe(
      `${PHOTO_PRIVACY_COPY} The camera view stays on your phone.`,
    );
  });
  it("constants other code and tests import", () => {
    expect(commonEn.unverifiedNote).toBe(
      "Measurements are still being validated.",
    );
    expect(DETECTOR_LOAD_FAILED_MESSAGE).toBe(
      "We couldn't load the hand detector. Check your connection and try again.",
    );
    expect(SUBMIT_ERROR_MESSAGES.network).toBe(
      "No connection — check your network, then try submitting again.",
    );
    expect(easyEn.noPaperEntry).toBe("No paper? Use a ruler instead");
    expect(easyEn.editHandLength).toBe("Edit hand length");
    expect(userLengthRangeMessage("en")).toBe(
      "Enter a hand length between 135 and 265 mm.",
    );
  });
  it("hand chip and numbers", () => {
    expect(handChipLabel({ hand: "right", locked: false }, "en")).toBe(
      "Right hand · auto",
    );
    expect(handChipLabel({ hand: "left", locked: true }, "en")).toBe(
      "Left hand",
    );
    expect(handChipAccessibleName({ hand: "left", locked: true }, "en")).toBe(
      "Left hand, set by you. Change hand",
    );
    expect(
      measuredNumbersText({
        handLengthMm: 186.4,
        palmWidthMm: 84.6,
        locale: "en",
      }),
    ).toBe("Hand length 186 mm · Palm width 85 mm");
    expect(
      measuredNumbersText({
        handLengthMm: 186.4,
        palmWidthMm: 84.6,
        enteredLengthMm: 190,
        locale: "en",
      }),
    ).toBe("Hand length 190 mm (entered) · Palm width 85 mm");
  });
  it("issue text in English is the issue's own message", () => {
    const issue = { code: "ANYTHING", message: "kept as is" };
    expect(issueText(issue, "en")).toBe("kept as is");
  });
});

describe("cues in zh-TW", () => {
  it("every code has a line, different from English, in both modes", () => {
    for (const code of CODES) {
      for (const mode of ["paper-edge", "printed-sheet"] as const) {
        const zh = cueMessage(code, mode, "zh-TW");
        expect(zh, `${code}/${mode}`).toMatch(CJK);
        expect(zh).not.toBe(cueMessage(code, mode, "en"));
      }
    }
  });
  it("the sheet variants say 校正表, the paper ones 紙", () => {
    expect(cueMessage("no-corners", "printed-sheet", "zh-TW")).toContain(
      "校正表",
    );
    expect(cueMessage("no-corners", "paper-edge", "zh-TW")).toContain("紙");
  });
  it("cue lines are short enough for a 320 px overlay", () => {
    // About 20 full-width characters is two lines at the overlay's font size.
    for (const code of CODES)
      expect(
        cueMessage(code, "paper-edge", "zh-TW").length,
      ).toBeLessThanOrEqual(20);
  });
  it("the paper-gate cues (S1) read as the draft words, zh-TW and English, side by side", () => {
    const sides = ["top", "bottom", "left", "right"] as const;
    const zhSide = { top: "上", bottom: "下", left: "左", right: "右" };
    const enSide = {
      top: "top",
      bottom: "bottom",
      left: "left",
      right: "right",
    };
    for (const side of sides) {
      const code = `edge-covered-${side}` as const;
      expect(cueMessage(code, "paper-edge", "zh-TW")).toBe(
        `紙的${zhSide[side]}緣被擋住，手往內移`,
      );
      expect(cueMessage(code, "paper-edge", "en")).toBe(
        `The ${enSide[side]} edge is covered. Move your hand in.`,
      );
    }
    expect(cueMessage("edge-covered", "paper-edge", "zh-TW")).toBe(
      "紙邊被擋住，手往內移",
    );
    expect(cueMessage("edge-covered", "paper-edge", "en")).toBe(
      "An edge is covered. Move your hand in.",
    );
    expect(cueMessage("paper-curled", "paper-edge", "zh-TW")).toBe(
      "請把紙壓平",
    );
    expect(cueMessage("paper-curled", "paper-edge", "en")).toBe(
      "Smooth the paper down.",
    );
  });
  it("the paper-gate cues exist in both tables with the same keys", () => {
    const keys = (t: typeof cuesEn.paper) => Object.keys(t).sort();
    expect(keys(cuesZh.paper)).toEqual(keys(cuesEn.paper));
    expect(Object.keys(cuesZh.sheet).sort()).toEqual(keys(cuesEn.paper));
    expect(Object.keys(cuesEn.sheet).sort()).toEqual(keys(cuesEn.paper));
  });
  it("the paper-gate cues stay short: zh-TW at most 14 characters, English at most 48", () => {
    const gateCodes: CueCode[] = [
      "edge-covered",
      "edge-covered-top",
      "edge-covered-bottom",
      "edge-covered-left",
      "edge-covered-right",
      "paper-curled",
    ];
    for (const code of gateCodes) {
      expect(
        cueMessage(code, "paper-edge", "zh-TW").length,
        code,
      ).toBeLessThanOrEqual(14);
      expect(
        cueMessage(code, "paper-edge", "en").length,
        code,
      ).toBeLessThanOrEqual(48);
    }
  });
  it("every English cue line fits 48 characters, for the paper and for the printed sheet", () => {
    for (const code of CODES)
      for (const mode of ["paper-edge", "printed-sheet"] as const)
        expect(
          cueMessage(code, mode, "en").length,
          `${code}/${mode}`,
        ).toBeLessThanOrEqual(48);
  });
  it("pickCue and cueFromCode carry the locale", () => {
    const cue = pickCue({ ...GOOD, cornersSeen: 0 }, "paper-edge", "zh-TW");
    expect(cue.code).toBe("no-corners");
    expect(cue.message).toBe(cuesZh.paper.noCorners);
    expect(cueFromCode("too-far", "paper-edge", "zh-TW").message).toBe(
      cuesZh.paper.tooFar,
    );
  });
  it("easyCueText and easyHintText follow the locale", () => {
    const perfect = cueFromCode("perfect", "paper-edge", "en");
    expect(easyCueText(perfect, { tapToFocus: false, locale: "zh-TW" })).toBe(
      cuesZh.gotIt,
    );
    expect(easyCueText(perfect, { tapToFocus: false, locale: "en" })).toBe(
      "Got it — hold still",
    );
    const blurry = cueFromCode("out-of-focus", "paper-edge", "en");
    expect(easyCueText(blurry, { tapToFocus: true, locale: "zh-TW" })).toBe(
      cuesZh.tapToFocus,
    );
    expect(easyCueText(blurry, { tapToFocus: true, locale: "en" })).toBe(
      "Tap the paper to focus",
    );
    // A cue built in English still reads in Chinese when asked to.
    expect(
      easyCueText(cueFromCode("too-close", "paper-edge", "en"), {
        tapToFocus: false,
        locale: "zh-TW",
      }),
    ).toBe(cuesZh.paper.tooClose);
    expect(
      easyHintText({
        cueCode: "perfect",
        ringFraction: 0.5,
        tapToFocus: false,
        locale: "zh-TW",
      }),
    ).toBe(cuesZh.holdStillTakingPhoto);
    expect(
      easyHintText({
        cueCode: "out-of-focus",
        ringFraction: 0,
        tapToFocus: false,
        locale: "zh-TW",
      }),
    ).toBe("");
    expect(
      easyHintText({
        cueCode: "out-of-focus",
        ringFraction: 0,
        tapToFocus: true,
        locale: "zh-TW",
      }),
    ).toBe(cuesZh.paper.outOfFocus);
  });
  it("status chips", () => {
    const zh = computeStatusChips(GOOD, "paper-edge", "zh-TW");
    expect(zh.paper.label).toBe("紙張 4/4");
    expect(zh.steady.label).toBe("穩定");
    expect(zh.light.label).toBe("光線");
    expect(computeStatusChips(GOOD, "printed-sheet", "zh-TW").paper.label).toBe(
      "校正表 4/4",
    );
    expect(computeStatusChips(GOOD, "paper-edge", "en").paper.label).toBe(
      "Paper 4/4",
    );
    expect(computeStatusChips(GOOD, "printed-sheet", "en").paper.label).toBe(
      "Sheet 4/4",
    );
  });
  it("the pointing line follows the mode", () => {
    expect(cameraCuesCopy("zh-TW").pointAtSheet).toContain("校正表");
    expect(cameraCuesCopy("en").pointAtPaper).toBe(
      "Point the camera at the paper",
    );
  });
});

describe("hand chip, numbers and labels in zh-TW", () => {
  it("hand chip", () => {
    expect(handChipLabel({ hand: "right", locked: false }, "zh-TW")).toBe(
      "右手 · 自動",
    );
    expect(handChipLabel({ hand: "left", locked: true }, "zh-TW")).toBe("左手");
    const name = handChipAccessibleName(
      { hand: "left", locked: false },
      "zh-TW",
    );
    // The accessible name starts with the visible text.
    expect(
      name.startsWith(handChipLabel({ hand: "left", locked: false }, "zh-TW")),
    ).toBe(true);
  });
  it("numbers are formatted in TypeScript and appear in the line", () => {
    const line = measuredNumbersText({
      handLengthMm: 186.4,
      palmWidthMm: 84.6,
      locale: "zh-TW",
    });
    expect(line).toBe("手長 186 mm · 掌寬 85 mm");
    expect(
      measuredSheetNumbers(
        { handLengthMm: 180, palmWidthMm: 80 },
        { method: "user-length", referenceMm: 190 },
        "zh-TW",
      ),
    ).toBe("手長 190 mm（自行輸入） · 掌寬 80 mm");
  });
  it("range message and no-paper labels", () => {
    expect(userLengthRangeMessage("zh-TW")).toBe(
      "請輸入 135 到 265 mm 之間的手長。",
    );
    expect(noPaperEntryLabel(false, "zh-TW", true)).toBe(easyZh.noPaperEntry);
    expect(noPaperEntryLabel(true, "zh-TW", true)).toBe(easyZh.editHandLength);
    expect(noPaperEntryLabel(false, "zh-TW", false)).toBeNull();
    expect(noPaperEntryLabel(false, "en", true)).toBe(
      "No paper? Use a ruler instead",
    );
  });
  it("grips use the results page's words", () => {
    expect(commonZh.gripPalm).toBe("趴握");
    expect(commonZh.gripClaw).toBe("抓握");
    expect(commonZh.gripFingertip).toBe("指握");
  });
  it("detector progress", () => {
    const state = {
      stage: "model",
      loadedBytes: 3_460_000,
      totalBytes: 7_800_000,
    } as const;
    expect(describeDetectorLoad(state, "zh-TW").text).toBe(
      "正在載入手部偵測模型",
    );
    expect(describeDetectorLoad(state, "en").text).toBe(
      "Loading the hand detector",
    );
    expect(describeDownload(state, "zh-TW").sizeText).toBe("3.5 / 7.8 MB");
    expect(describeDownload(state, "en").sizeText).toBe("3.5 of 7.8 MB");
    expect(describeDetectorLoad({ stage: "runtime" }, "zh-TW").text).toBe(
      "正在啟動手部偵測模型",
    );
    expect(scanCommonCopy("zh-TW").detectorPercent(40)).toBe("40%");
    expect(scanCommonCopy("en").detectorPercent(40)).toBe("40 percent");
  });
  it("submit errors cover every kind in both locales", () => {
    for (const kind of Object.keys(SUBMIT_ERROR_MESSAGES) as Array<
      keyof typeof SUBMIT_ERROR_MESSAGES
    >) {
      expect(commonEn.submitErrors[kind]).toBe(SUBMIT_ERROR_MESSAGES[kind]);
      expect(commonZh.submitErrors[kind]).toMatch(CJK);
    }
  });
  it("sheet and easy functions put their numbers in", () => {
    expect(easyZh.dimHand("186")).toContain("186");
    expect(easyZh.lengthHint(135, 265)).toContain("135");
    expect(easyZh.lengthHint(135, 265)).toContain("265");
    expect(sheetZh.cardCornerLabel(3)).toContain("3");
    expect(sheetZh.dimPalmWidth("84.6")).toContain("84.6");
    expect(easyEn.dimPalm("80")).toBe("Palm 80 mm");
    expect(easyEn.tipPaperOnTable("A4")).toBe("A4 paper on a darker table");
    expect(easyZh.lengthChip("190")).toContain("190");
    expect(sheetEn.camera.checkSubtitle("sheet")).toBe(
      "Make sure your whole hand and all four sheet corners are visible.",
    );
    expect(sheetZh.camera.checkSubtitle("校正表")).toContain("校正表");
  });
});

describe("issueText", () => {
  const fixtures = [
    checkMarkers([0, 1, 2]),
    checkHandDetected(0),
    checkHandedness("left", "right"),
    checkLandmarkConfidence(0.1),
    checkHandInBounds([{ x: 9999, y: 0 }], [{ x: 0, y: 0 }]),
    checkReprojectionError(5),
    checkCardScale(2),
    checkPaperFound(false),
    checkPaperCornersSeen(2),
    checkPaperEdgeCoverage(0),
    checkPaperCurled(999),
    checkSharpness(0),
    checkUserLengthStraightness([]),
    checkUserLengthProportion({
      handLengthMm: 200,
      palmWidthMm: 150,
    } as never),
  ];
  it("the fixtures are real failures", () => {
    for (const f of fixtures) expect(f, JSON.stringify(f)).not.toBeNull();
  });
  it("gives every real gate failure Chinese words, and English its own message", () => {
    for (const f of fixtures) {
      if (!f) continue;
      expect(issueText(f, "en")).toBe(f.message);
      const zh = issueText(f, "zh-TW");
      expect(zh, f.code).toMatch(CJK);
      expect(zh, f.code).not.toBe(f.message);
    }
  });
  it("covers the codes the pipeline builds itself", () => {
    const issues = [
      {
        code: "MEASUREMENT_OUT_OF_RANGE",
        message:
          "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
      },
      { code: "DECODE_FAILED", message: HEIC_RETAKE_MESSAGE },
      { code: "DETECTOR_LOAD_FAILED", message: DETECTOR_LOAD_FAILED_MESSAGE },
      { code: "detector_load_failed", message: DETECTOR_LOAD_FAILED_MESSAGE },
      { code: "PROCESSING_FAILED", message: issuesEn.processingFailed },
      { code: "processing_failed", message: "anything" },
      { code: "UNEXPECTED", message: issuesEn.unexpected },
    ];
    for (const issue of issues) {
      expect(issueText(issue, "zh-TW"), issue.code).toMatch(CJK);
    }
    expect(issueText(issues[0], "zh-TW")).toBe(issuesZh.measurementImplausible);
  });
  it("English table matches the messages the code builds", () => {
    expect(issuesEn.measurementImplausible).toBe(
      "These measurements look implausible — retake with your whole hand flat on the sheet and the camera directly overhead.",
    );
    expect(issuesEn.decodeFailed).toBe(HEIC_RETAKE_MESSAGE);
    expect(issuesEn.handNotDetected("sheet")).toBe(
      checkHandDetected(0)?.message,
    );
    expect(issuesEn.handNotDetected("paper")).toBe(
      checkHandDetected(0, "paper")?.message,
    );
    // The no-paper pipeline builds this one inline (pipeline.ts).
    expect(issuesEn.handNotDetected("nothing")).toBe(
      "We couldn't find a hand — keep your whole hand in view, fingers together, and retake.",
    );
    expect(issuesEn.handednessMismatch("left", "right", "picker")).toBe(
      checkHandedness("left", "right")?.message,
    );
    expect(issuesEn.handednessMismatch("left", "right", "button")).toBe(
      checkHandedness("left", "right", "tap the hand button below")?.message,
    );
    expect(issuesEn.paperCurled).toBe(checkPaperCurled(999)?.message);
    expect(issuesEn.fingerNotStraight).toBe(
      checkUserLengthStraightness([])?.message,
    );
    expect(issuesEn.measurementOutOfRangeTyped("186")).toBe(
      userLengthRetakeMessage(186),
    );
  });
  it("reads the hand and the fix from the gate's detail, in both locales", () => {
    const failure = checkHandedness("left", "right")!;
    expect(failure.detail).toEqual({
      kind: "handedness",
      detected: "left",
      stated: "right",
      fix: "picker",
    });
    // The English message is the sentence it always was.
    expect(failure.message).toBe(
      "This looks like your left hand, but you selected right. Retake with your right hand, or change the hand picker.",
    );
    expect(issueText(failure, "en")).toBe(failure.message);
    const picker = issueText(failure, "zh-TW");
    expect(picker).toBe(issuesZh.handednessMismatch("left", "right", "picker"));
    expect(picker).toContain("左手");
    expect(picker).toContain("右手");
    const buttonFailure = checkHandedness(
      "right",
      "left",
      "tap the hand button below",
    )!;
    expect(buttonFailure.detail).toMatchObject({ fix: "button" });
    expect(buttonFailure.message).toContain("or tap the hand button below.");
    const button = issueText(buttonFailure, "zh-TW");
    expect(button).toBe(issuesZh.handednessMismatch("right", "left", "button"));
    expect(button).not.toBe(
      issuesZh.handednessMismatch("right", "left", "picker"),
    );
  });
  it("shows the typed length from the detail, equal to typedMm", () => {
    for (const typedMm of [120, 186, 190.5]) {
      const issue = {
        code: "MEASUREMENT_OUT_OF_RANGE",
        message: userLengthRetakeMessage(typedMm),
        detail: { kind: "typedLength" as const, typedMm },
      };
      const zh = issueText(issue, "zh-TW");
      expect(zh).toBe(issuesZh.measurementOutOfRangeTyped(String(typedMm)));
      expect(zh).toContain(String(typedMm));
      expect(issueText(issue, "en")).toBe(issue.message);
    }
  });
  it("without a detail, a typed-length code says the generic thing", () => {
    expect(
      issueText(
        {
          code: "MEASUREMENT_OUT_OF_RANGE",
          message: userLengthRetakeMessage(120),
        },
        "zh-TW",
      ),
    ).toBe(issuesZh.measurementImplausible);
  });
  it("an unknown code falls back to the English message", () => {
    expect(issueText({ code: "NEW_ONE", message: "hello" }, "zh-TW")).toBe(
      "hello",
    );
  });
  it("an unparsable handedness message falls back too", () => {
    expect(
      issueText({ code: "HANDEDNESS_MISMATCH", message: "odd" }, "zh-TW"),
    ).toBe("odd");
  });
});
