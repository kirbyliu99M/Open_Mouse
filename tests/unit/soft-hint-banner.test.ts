/**
 * V3.3 WP3b (candidate 未拍板): the post-shot banner. At most one per photo,
 * closable, not shown again after 3 in a row, `blurry` off by default, its
 * outcome kept in the local attempt log, and none of it with the hints off.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SOFT_HINT_BANNER_SWITCHES,
  pickSoftHintBanner,
  softHintBannerText,
  softHintBannerThresholds,
  type SoftHintBannerSwitches,
} from "../../src/client/camera/softHintBanner";
import { SoftHintBanner } from "../../src/client/camera/SoftHintBannerView";
import {
  meanFingerRatio,
  pickSoftHint,
  type SoftHintCode,
  type SoftHintInput,
} from "../../src/client/photo/softHint";
import {
  appendAttempt,
  recordSoftHintBannerOutcome,
  sanitizeAttempt,
  softHintBannerHistoryOf,
  withSoftHintBannerOutcome,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import type { StorageLike } from "../../src/client/camera/easyScanPreferences";

const CLEAN: SoftHintInput = {
  wristToEdgeMm: 8,
  handAxisDeg: 0,
  minSideMarginMm: 20,
  palmOverHand: 0.5,
  reachMean: 0.9,
  palmTiltDeg: 3,
  fingerFlexDeg: [5, 5, 5, 5],
  sharpness: 200,
  paperWidthFraction: 0.65,
};

const ALL_ON: SoftHintBannerSwitches = {
  ...SOFT_HINT_BANNER_SWITCHES,
  wristAlign: true,
  handFlat: true,
  blurry: true,
};

describe("which banners are on by default", () => {
  it("only wrist-align; blurry, hand-flat and the hints without words are off", () => {
    expect(SOFT_HINT_BANNER_SWITCHES).toMatchObject({
      wristAlign: true,
      handFlat: false,
      blurry: false,
      palmTilt: false,
      fingerFlex: false,
      handStraight: false,
      handInside: false,
      paperSmall: false,
    });
  });
  it("blurry is not shown by default, however soft the photo", () => {
    expect(pickSoftHintBanner({ ...CLEAN, sharpness: 1 }, []).code).toBe(null);
    // Switched on, it is.
    expect(
      pickSoftHintBanner({ ...CLEAN, sharpness: 1 }, [], ALL_ON).code,
    ).toBe("blurry");
  });
  it("hand-flat is not shown by default", () => {
    expect(pickSoftHintBanner({ ...CLEAN, palmOverHand: 0.4 }, []).code).toBe(
      null,
    );
    expect(
      pickSoftHintBanner({ ...CLEAN, palmOverHand: 0.4 }, [], ALL_ON).code,
    ).toBe("hand-flat");
  });
  it("a switched-off hint does not stand in front of one that is on", () => {
    // paper-small and hand-inside come first in softHint.ts's order, and are off.
    expect(
      pickSoftHintBanner(
        {
          ...CLEAN,
          paperWidthFraction: 0.3,
          minSideMarginMm: 0,
          wristToEdgeMm: 40,
        },
        [],
      ).code,
    ).toBe("wrist-align");
  });
  it("the switched-off bounds are opened, the rest are softHint.ts's", () => {
    const t = softHintBannerThresholds();
    expect(t.wristToEdgeMinMm).toBe(-Infinity);
    expect(t.wristToEdgeMaxMm).toBe(15);
    expect(t.minSharpness).toBe(null);
    expect(t.minPaperWidthFraction).toBe(-Infinity);
    expect(t.repeatLimit).toBe(3);
  });
});

describe("one banner per photo, and the repeat throttle", () => {
  it("at most one, even when several fire", () => {
    const r = pickSoftHintBanner(
      { ...CLEAN, wristToEdgeMm: 40, palmOverHand: 0.3, sharpness: 1 },
      [],
      ALL_ON,
    );
    expect(r.code).toBe("wrist-align");
    expect(r.fired.length).toBeGreaterThan(1);
  });
  it("the same banner 3 photos in a row on this device is not shown a 4th time", () => {
    let history: (SoftHintCode | null)[] = [];
    const shown: (SoftHintCode | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const r = pickSoftHintBanner({ ...CLEAN, wristToEdgeMm: 40 }, history);
      shown.push(r.code);
      history = [...history, r.candidate];
    }
    expect(shown).toEqual([
      "wrist-align",
      "wrist-align",
      "wrist-align",
      null,
      null,
    ]);
    // A photo without it breaks the streak.
    history = [...history, null];
    expect(
      pickSoftHintBanner({ ...CLEAN, wristToEdgeMm: 40 }, history).code,
    ).toBe("wrist-align");
  });
  it("words in both locales", () => {
    expect(softHintBannerText("wrist-align", "zh-TW")).toBe(
      "手腕沒貼齊下緣，建議重拍",
    );
    expect(softHintBannerText("wrist-align", "en")).toBe(
      "Wrist isn't at the bottom edge. Try a retake.",
    );
    expect(softHintBannerText("hand-flat", "zh-TW")).toBe(
      "手掌沒壓平，建議重拍",
    );
    expect(softHintBannerText("hand-flat", "en")).toBe(
      "Palm isn't flat. Try a retake.",
    );
    expect(softHintBannerText("blurry", "zh-TW")).toBe(
      "照片有點糊，擦擦鏡頭再拍",
    );
    expect(softHintBannerText("blurry", "en")).toBe(
      "Photo is a bit blurry. Wipe the lens and retake.",
    );
  });
});

describe("the banner's record in the local attempt log", () => {
  const base = (at: string, banner?: object): AttemptRecord =>
    sanitizeAttempt({
      v: 1,
      at,
      result: "ok",
      userAgent: "t",
      ...(banner ? { softHintBanner: banner } : {}),
    }) as AttemptRecord;

  it("round-trips through sanitizeAttempt; unknown values are cleaned", () => {
    const r = base("2026-10-26T00:00:00.000Z", {
      code: "wrist-align",
      candidate: "wrist-align",
      suppressed: false,
      dismissed: true,
      after: "retake",
    });
    expect(r?.softHintBanner).toEqual({
      code: "wrist-align",
      candidate: "wrist-align",
      suppressed: false,
      dismissed: true,
      after: "retake",
    });
    const bad = base("2026-10-26T00:00:00.000Z", {
      code: "<img>",
      after: "elsewhere",
    });
    expect(bad?.softHintBanner).toEqual({
      code: null,
      candidate: null,
      suppressed: false,
      dismissed: false,
      after: null,
    });
    expect(base("2026-10-26T00:00:00.000Z")?.softHintBanner).toBeUndefined();
  });

  it("history: only records that worked a banner out, oldest first", () => {
    const list = [
      base("2026-10-26T00:00:01.000Z", { candidate: "wrist-align" }),
      base("2026-10-26T00:00:02.000Z"),
      base("2026-10-26T00:00:03.000Z", { candidate: null }),
    ];
    expect(softHintBannerHistoryOf(list)).toEqual(["wrist-align", null]);
  });

  it("closing and retaking are written to that photo's record; a retake is never replaced by continue", () => {
    const at = "2026-10-26T00:00:05.000Z";
    let list = [base(at, { code: "wrist-align", candidate: "wrist-align" })];
    list = withSoftHintBannerOutcome(list, at, { dismissed: true });
    expect(list[0].softHintBanner?.dismissed).toBe(true);
    list = withSoftHintBannerOutcome(list, at, { after: "retake" });
    list = withSoftHintBannerOutcome(list, at, { after: "continue" });
    expect(list[0].softHintBanner).toMatchObject({
      dismissed: true,
      after: "retake",
    });
    // Another record, or one without a banner, is left alone.
    const other = [base(at)];
    expect(withSoftHintBannerOutcome(other, at, { after: "retake" })).toEqual(
      other,
    );
  });

  it("the outcome is stored on the device, and a store that throws breaks nothing", () => {
    const at = "2026-10-26T00:00:06.000Z";
    const rec = base(at, { code: "wrist-align", candidate: "wrist-align" });
    const data: Record<string, string> = {};
    const storage: StorageLike = {
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => {
        data[k] = v;
      },
    };
    storage.setItem(
      "openMouse.easyScan.attempts.v1",
      JSON.stringify(appendAttempt([], rec)),
    );
    const session = recordSoftHintBannerOutcome(
      storage,
      at,
      { after: "continue" },
      [rec],
    );
    expect(session[0].softHintBanner?.after).toBe("continue");
    const stored = JSON.parse(data["openMouse.easyScan.attempts.v1"]);
    expect(stored[0].softHintBanner.after).toBe("continue");
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() =>
      recordSoftHintBannerOutcome(broken, at, { dismissed: true }, [rec]),
    ).not.toThrow();
  });
});

describe("SoftHintBanner (the view)", () => {
  const html = renderToStaticMarkup(
    createElement(SoftHintBanner, {
      text: "手腕沒貼齊下緣，建議重拍",
      dismissLabel: "關閉提示",
      onDismiss: () => {},
      leaving: false,
    }),
  );
  it("one line of words and a close button with a name", () => {
    expect(html).toContain("手腕沒貼齊下緣，建議重拍");
    expect(html).toMatch(/<button[^>]*aria-label="關閉提示"/);
    // In the sheet, not a popover over the photo (Kirby 2026-10-27).
    expect(html).not.toContain("popover");
    expect(html).toContain('role="status"');
  });
  it("its close button is a 44 px target (CSS)", () => {
    const css = readFileSync("src/client/camera/easy-scan.css", "utf8");
    const rule = css.slice(css.indexOf(".easySoftHintClose {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(
      /min-width: 44px;[\s\S]*min-height: 44px;/,
    );
    // The motion tokens: in on --motion-base, out on --motion-out, reduced.
    expect(css).toMatch(
      /\.easySoftHint \{[\s\S]*?easyFadeIn var\(--motion-base\)/,
    );
    expect(css).toMatch(
      /\.easySoftHint\[data-leaving="true"\] \{\s*animation: easyFadeOut var\(--motion-out\)/,
    );
    expect(css).toMatch(
      /easyFadeIn var\(--motion-reduced\) linear backwards;\s*\}\s*\.easySoftHint\[data-leaving/,
    );
  });
});

describe("the curled-fingers banner (Kirby's S25 test, 2026-10-26)", () => {
  // His two photos: slightly curved (shown nothing) and fully curled.
  const photo = (
    fingerRatioMean: number,
    palmOverHand: number,
    reachMean: number,
  ) => ({
    wristToEdgeMm: 8,
    handAxisDeg: 0,
    minSideMarginMm: 50,
    palmOverHand,
    reachMean,
    palmTiltDeg: 40,
    fingerFlexDeg: [36, 36, 36, 36],
    fingerRatioMean,
    sharpness: 45,
    paperWidthFraction: 0.69,
  });
  it("fires 手掌沒壓平 on the full curl, not on the slightly curved hand", () => {
    const t = softHintBannerThresholds();
    expect(pickSoftHint(photo(0.1758, 0.519, 0.792), [], t).code).toBe(
      "hand-flat",
    );
    expect(pickSoftHint(photo(0.4711, 0.4791, 0.898), [], t).code).toBe(null);
  });
  it("meanFingerRatio is the four fingers' mean, null without all four", () => {
    expect(meanFingerRatio([0.1, 0.2, 0.3, 0.4])).toBeCloseTo(0.25, 10);
    expect(meanFingerRatio(null)).toBe(null);
    expect(meanFingerRatio([0.1, 0.2, 0.3])).toBe(null);
    expect(meanFingerRatio([0.1, 0.2, Number.NaN, 0.4])).toBe(null);
  });
});
