import { describe, expect, it } from "vitest";
import {
  PROPOSED_SCAN_TOUR_EVENT_SCHEMAS,
  SCAN_TOUR_EVENT_NAMES,
  sendTourEvent,
  tourEventProps,
} from "../../src/client/camera/tour/tourAnalytics";
import {
  SCREEN_MARGIN,
  SPOTLIGHT_PAD,
  buildTourSteps,
  guideRectInViewport,
  inflateRect,
  placeTooltip,
  spotlightRadius,
  tourTransition,
  unionRect,
  visibleTourSteps,
  type Rect,
  type TourEffect,
  type TourState,
  type TourStepDef,
  type TourTargetId,
} from "../../src/client/camera/tour/tourModel";
import { stepBody, stepTitle } from "../../src/client/camera/tour/tourText";
import { zhTW } from "../../src/lib/copy/scan-tour";

const PAPER = buildTourSteps({ reference: "a4", cardModeAvailable: false });

function run(
  events: Parameters<typeof tourTransition>[1][],
  steps: readonly TourStepDef[] = PAPER,
  start: TourState = { phase: "closed" },
) {
  let state = start;
  const effects: TourEffect[] = [];
  for (const e of events) {
    const t = tourTransition(state, e, steps);
    state = t.state;
    effects.push(...t.effects);
  }
  return { state, effects };
}

const tracked = (effects: readonly TourEffect[]) =>
  effects.flatMap((e) => (e.kind === "track" ? [e.event] : []));
const has = (effects: readonly TourEffect[], kind: TourEffect["kind"]) =>
  effects.some((e) => e.kind === kind);

describe("buildTourSteps", () => {
  it("paper: four steps, reference chip, paper frame, cue, shutter", () => {
    expect(PAPER.map((s) => s.target)).toEqual([
      "reference-chip",
      "paper-frame",
      "cue",
      "shutter",
    ]);
    expect(PAPER[0].choice).toBe(false);
    expect(PAPER[1].placement).toBe("dock-bottom");
  });

  it("card mode on and card chosen: choice in step 1, card slot in step 2", () => {
    const steps = buildTourSteps({
      reference: "card",
      cardModeAvailable: true,
    });
    expect(steps[0].choice).toBe(true);
    expect(steps[1].target).toBe("card-slot");
    expect(steps[1].placement).toBe("auto");
  });

  it("card mode on, paper chosen: choice in step 1, paper frame in step 2", () => {
    const steps = buildTourSteps({ reference: "a4", cardModeAvailable: true });
    expect(steps[0].choice).toBe(true);
    expect(steps[1].target).toBe("paper-frame");
  });

  it("a stored 'card' without card mode falls back to the paper tour", () => {
    const steps = buildTourSteps({
      reference: "card",
      cardModeAvailable: false,
    });
    expect(steps).toEqual(PAPER);
  });
});

describe("visibleTourSteps (Toutour when rule)", () => {
  it("drops steps whose target is missing before counting", () => {
    const missing = new Set<TourTargetId>(["card-slot"]);
    const steps = visibleTourSteps(
      buildTourSteps({ reference: "card", cardModeAvailable: true }),
      (t) => !missing.has(t),
    );
    expect(steps.map((s) => s.id)).toEqual(["reference", "cue", "shutter"]);
  });
});

describe("tourTransition", () => {
  it("first use: welcome, then 'first' starts at step 1", () => {
    const { state, effects } = run([
      { type: "openAuto" },
      { type: "answerFirst" },
    ]);
    expect(state).toEqual({ phase: "step", index: 0, trigger: "auto" });
    expect(tracked(effects)).toEqual([
      { name: "scan_tour_first_use_answer", answer: "first" },
      { name: "scan_tour_started", trigger: "auto" },
      { name: "scan_tour_step_viewed", step: 1, stepId: "reference" },
    ]);
    expect(has(effects, "markSeen")).toBe(false);
  });

  it("first use: 'returning' closes and marks seen", () => {
    const { state, effects } = run([
      { type: "openAuto" },
      { type: "answerReturning" },
    ]);
    expect(state.phase).toBe("closed");
    expect(has(effects, "markSeen")).toBe(true);
    expect(has(effects, "close")).toBe(true);
  });

  it("'?' goes straight to step 1 without the question", () => {
    const { state, effects } = run([{ type: "openHelp" }]);
    expect(state).toEqual({ phase: "step", index: 0, trigger: "help" });
    expect(tracked(effects)[0]).toEqual({
      name: "scan_tour_started",
      trigger: "help",
    });
  });

  it("next / back walk the steps; back on step 1 does nothing", () => {
    const { state } = run([
      { type: "openHelp" },
      { type: "back" },
      { type: "next" },
      { type: "next" },
      { type: "back" },
    ]);
    expect(state).toEqual({ phase: "step", index: 1, trigger: "help" });
  });

  it("next on the last step completes, marks seen and closes", () => {
    const { state, effects } = run([
      { type: "openHelp" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
      { type: "next" },
    ]);
    expect(state.phase).toBe("closed");
    expect(tracked(effects).at(-1)).toEqual({ name: "scan_tour_completed" });
    expect(has(effects, "markSeen")).toBe(true);
    expect(has(effects, "close")).toBe(true);
  });

  it("skip records the step it was on and marks seen", () => {
    const { state, effects } = run([
      { type: "openHelp" },
      { type: "next" },
      { type: "skip" },
    ]);
    expect(state.phase).toBe("closed");
    expect(tracked(effects).at(-1)).toEqual({
      name: "scan_tour_skipped",
      step: 2,
    });
    expect(has(effects, "markSeen")).toBe(true);
  });

  it("skip on the question records step 0", () => {
    const { effects } = run([{ type: "openAuto" }, { type: "skip" }]);
    expect(tracked(effects)).toEqual([{ name: "scan_tour_skipped", step: 0 }]);
  });

  it("with nothing to point at, it closes without marking seen", () => {
    const help = run([{ type: "openHelp" }], []);
    expect(help.state.phase).toBe("closed");
    expect(has(help.effects, "close")).toBe(true);
    expect(has(help.effects, "markSeen")).toBe(false);
    const auto = run([{ type: "openAuto" }, { type: "answerFirst" }], []);
    expect(auto.state.phase).toBe("closed");
    expect(has(auto.effects, "markSeen")).toBe(false);
  });

  it("a target that disappears clamps the step index", () => {
    const at4: TourState = { phase: "step", index: 3, trigger: "auto" };
    const { state, effects } = run(
      [{ type: "stepsChanged" }],
      PAPER.slice(0, 2),
      at4,
    );
    expect(state).toEqual({ phase: "step", index: 1, trigger: "auto" });
    expect(tracked(effects)).toEqual([
      { name: "scan_tour_step_viewed", step: 2, stepId: "placement" },
    ]);
  });

  it("all targets gone closes the tour", () => {
    const { state, effects } = run([{ type: "stepsChanged" }], [], {
      phase: "step",
      index: 0,
      trigger: "auto",
    });
    expect(state.phase).toBe("closed");
    expect(has(effects, "close")).toBe(true);
  });

  it("opening twice is a no-op", () => {
    const { state, effects } = run([
      { type: "openHelp" },
      { type: "openAuto" },
    ]);
    expect(state.phase).toBe("step");
    expect(tracked(effects)).toHaveLength(2);
  });
});

describe("geometry", () => {
  const viewport = { width: 390, height: 844 };
  const tooltip = { width: 358, height: 232 };

  it("spotlight is 6 px outside the target; a pill stays a pill", () => {
    const hole = inflateRect(
      { x: 100, y: 100, width: 80, height: 44 },
      SPOTLIGHT_PAD,
    );
    expect(hole).toEqual({ x: 94, y: 94, width: 92, height: 56 });
    expect(spotlightRadius(999, hole)).toBe(28);
    expect(spotlightRadius(10, hole)).toBe(16);
  });

  it("a target low on screen gets the card above, arrow down at its centre", () => {
    const shutter: Rect = { x: 147, y: 620, width: 96, height: 96 };
    const p = placeTooltip(shutter, tooltip, viewport, "auto");
    expect(p.arrow?.side).toBe("bottom");
    expect(p.y + tooltip.height).toBeLessThanOrEqual(shutter.y);
    expect(p.x + p.arrow!.offset).toBeCloseTo(shutter.x + shutter.width / 2, 0);
    expect(p.overlaps).toBe(false);
  });

  it("a target high on screen gets the card below, arrow up", () => {
    const cue: Rect = { x: 95, y: 105, width: 200, height: 44 };
    const p = placeTooltip(cue, tooltip, viewport, "auto");
    expect(p.arrow?.side).toBe("top");
    expect(p.y).toBeGreaterThanOrEqual(cue.y + cue.height);
  });

  it("the card stays on screen near an edge chip", () => {
    const chip: Rect = { x: 20, y: 640, width: 60, height: 44 };
    const p = placeTooltip(chip, tooltip, viewport, "auto");
    expect(p.x).toBeGreaterThanOrEqual(SCREEN_MARGIN);
    expect(p.x + p.width).toBeLessThanOrEqual(viewport.width - SCREEN_MARGIN);
    expect(p.arrow!.offset).toBeGreaterThanOrEqual(24);
  });

  it("docked card sits at the bottom with no arrow and clears the frame", () => {
    const frame: Rect = { x: 16, y: 90, width: 358, height: 480 };
    const p = placeTooltip(frame, tooltip, viewport, "dock-bottom");
    expect(p.arrow).toBeNull();
    expect(p.y + tooltip.height).toBe(viewport.height - SCREEN_MARGIN);
    expect(p.y).toBeGreaterThanOrEqual(frame.y + frame.height);
    expect(p.overlaps).toBe(false);
  });

  it("reports an overlap when nothing fits", () => {
    const huge: Rect = { x: 0, y: 40, width: 390, height: 760 };
    expect(placeTooltip(huge, tooltip, viewport, "dock-bottom").overlaps).toBe(
      true,
    );
    expect(placeTooltip(huge, tooltip, viewport, "auto").overlaps).toBe(true);
  });

  it("the card is never wider than the screen minus the margins", () => {
    const p = placeTooltip(
      { x: 10, y: 10, width: 10, height: 10 },
      tooltip,
      { width: 360, height: 640 },
      "auto",
    );
    expect(p.width).toBe(360 - 2 * SCREEN_MARGIN);
  });

  it("guide corners in stage pixels become a viewport rect", () => {
    expect(
      guideRectInViewport({ left: 0, top: 50 }, [
        { x: 20, y: 30 },
        { x: 370, y: 30 },
        { x: 370, y: 520 },
        { x: 20, y: 520 },
      ]),
    ).toEqual({ x: 20, y: 80, width: 350, height: 490 });
    expect(guideRectInViewport(null, [{ x: 0, y: 0 }])).toBeNull();
    expect(guideRectInViewport({ left: 0, top: 0 }, null)).toBeNull();
  });

  it("unionRect covers both", () => {
    expect(
      unionRect(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 5, y: 20, width: 10, height: 4 },
      ),
    ).toEqual({ x: 0, y: 0, width: 15, height: 24 });
  });
});

describe("step text", () => {
  const ctx = { reference: "a4" as const, isCard: false, noPaperEntry: true };

  it("paper steps use the approved wording", () => {
    expect(stepTitle(PAPER[0], zhTW, false)).toBe("先確認紙張大小");
    expect(stepBody(PAPER[0], zhTW, ctx)).toEqual([
      "預設是 A4。用 Letter 紙的話，點這裡切換。",
      "沒有紙？最下面可以改用尺量手長。",
    ]);
    expect(stepBody(PAPER[2], zhTW, ctx)[0]).toContain("「很好，請拿穩」");
    expect(stepBody(PAPER[3], zhTW, ctx)[0]).toContain("外圈跑滿");
  });

  it("no 'no paper' line when that entry is off", () => {
    expect(
      stepBody(PAPER[0], zhTW, { ...ctx, noPaperEntry: false }),
    ).toHaveLength(1);
  });

  it("card steps say the card cue and the card shutter line", () => {
    const steps = buildTourSteps({
      reference: "card",
      cardModeAvailable: true,
    });
    const card = {
      reference: "card" as const,
      isCard: true,
      noPaperEntry: true,
    };
    expect(stepTitle(steps[0], zhTW, true)).toBe("你用什麼對照？");
    expect(stepBody(steps[0], zhTW, card)[0]).toContain("悠遊卡");
    expect(stepTitle(steps[1], zhTW, true)).toBe("手和卡片這樣放");
    expect(stepBody(steps[2], zhTW, card)[0]).toContain(
      "「就是這樣，保持不動」",
    );
    expect(stepBody(steps[3], zhTW, card)[0]).toBe(
      "手和卡片都對好後會自動拍；也可以自己按。",
    );
  });
});

describe("tour analytics isolation", () => {
  it("sends nothing while the contract does not list the event", () => {
    const sent: string[] = [];
    const ok = sendTourEvent({ name: "scan_tour_completed" }, "a4", {
      schemas: {},
      send: (name) => sent.push(name),
    });
    expect(ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it("sends with the reference once the contract lists it", () => {
    const sent: [string, unknown][] = [];
    const ok = sendTourEvent({ name: "scan_tour_skipped", step: 2 }, "card", {
      schemas: { scan_tour_skipped: {} },
      send: (name, props) => sent.push([name, props]),
    });
    expect(ok).toBe(true);
    expect(sent).toEqual([
      ["scan_tour_skipped", { step: 2, reference: "card" }],
    ]);
  });

  it("never throws even if sending throws", () => {
    expect(
      sendTourEvent({ name: "scan_tour_completed" }, "a4", {
        schemas: { scan_tour_completed: {} },
        send: () => {
          throw new Error("boom");
        },
      }),
    ).toBe(false);
  });

  it("every event the model emits passes its proposed schema", () => {
    const events = [
      { name: "scan_tour_started", trigger: "auto" },
      { name: "scan_tour_step_viewed", step: 4, stepId: "shutter" },
      { name: "scan_tour_completed" },
      { name: "scan_tour_skipped", step: 0 },
      { name: "scan_tour_first_use_answer", answer: "returning" },
    ] as const;
    for (const e of events) {
      const { name, props } = tourEventProps(e, "letter");
      expect(SCAN_TOUR_EVENT_NAMES).toContain(name);
      expect(
        PROPOSED_SCAN_TOUR_EVENT_SCHEMAS[name].safeParse(props).success,
      ).toBe(true);
    }
  });
});
