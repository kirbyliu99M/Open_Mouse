import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnonymousAnswerLink } from "../../src/app/account/AnonymousAnswerLink";
import {
  SignedInProfile,
  SignedOutAnswer,
} from "../../src/app/account/AccountClient";
import {
  MouseChoiceFlow,
  OtherMouseSheet,
} from "../../src/app/account/MouseChoice";
import {
  OtherAnswerSheet,
  OtherMouseEditSheet,
  RatingSheet,
  RemoveConfirm,
} from "../../src/app/account/MouseEditSheets";
import { QuestionnaireForm } from "../../src/app/account/QuestionnaireForm";
import type { AnswersState } from "../../src/app/account/profile-model";
import {
  emptyForm,
  emptyOtherDraft,
  emptyRatingDraft,
  type CatalogueChoice,
  type FormState,
} from "../../src/app/account/questionnaire-model";
import {
  MAX_FEEDBACK_CHARS,
  OTHER_MOUSE_BRANDS,
  surveyMineResponseSchema,
} from "../../src/lib/contracts/survey";
import { zhTW as copy } from "../../src/lib/copy/questionnaire";
import { zhTW as account } from "../../src/lib/copy/account";

/**
 * The questionnaire's screens as static markup in zh-TW. An effect does not run
 * in a static render, so a dialog is present but not opened, and what is
 * checked is structure: the legends, the accessible names, the real state of a
 * chip, which buttons are off, and which controls are drawn at all.
 */

const SCAN = "6f1c1b6e-8d0e-4a0f-9d63-0b1a2c3d4e5f";

const CATALOGUE: CatalogueChoice[] = [
  { slug: "razer-deathadder-v3", brand: "Razer", model: "DeathAdder V3" },
  {
    slug: "logitech-g-pro-x-superlight-2",
    brand: "Logitech",
    model: "G Pro X Superlight 2",
  },
  { slug: "logitech-g502-x-plus", brand: "Logitech", model: "G502 X Plus" },
  { slug: "zowie-s2-c", brand: "Zowie", model: "S2-C" },
];

const NAMES: Record<string, string> = {
  "razer-deathadder-v3": "Razer DeathAdder V3",
  "logitech-g-pro-x-superlight-2": "Logitech G Pro X Superlight 2",
};

const noop = () => {};

function form(patch: Partial<FormState>): FormState {
  return { ...emptyForm(), ...patch };
}

function renderForm(initialForm?: FormState): string {
  return renderToStaticMarkup(
    createElement(QuestionnaireForm, {
      scanId: SCAN,
      signedIn: true,
      catalogue: CATALOGUE,
      mouseNames: NAMES,
      initialForm,
      onClose: noop,
      onSubmitted: noop,
    }),
  );
}

const RATED = form({
  current: {
    kind: "rating",
    draft: {
      slug: "logitech-g-pro-x-superlight-2",
      satisfaction: 4,
      duration: "6_to_12_months",
      painPoints: ["length"],
    },
  },
  mainUse: "gaming",
});

describe("the first-time form", () => {
  it("opens empty: the first question, the optional ones, the consent, and a submit that is off", () => {
    const html = renderForm();
    expect(html).toContain(`<h2`);
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.subtitle);
    for (const legend of [
      copy.qCurrent,
      copy.qMainUse,
      copy.qOthers,
      copy.qComment,
    ]) {
      expect(html).toContain(legend);
    }
    // The first question opens a sheet.
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(copy.choosePlaceholder);
    // The questions that belong to a chosen catalogue mouse are not asked yet.
    expect(html).not.toContain(copy.qSatisfaction);
    expect(html).not.toContain(copy.qDuration);
    expect(html).not.toContain(copy.qPain);
    // The consent is a real checkbox, not ticked; submit is off.
    expect(html).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked)[^>]*>/);
    expect(html).toContain(copy.consentLabel);
    expect(html).toContain(copy.consentKept);
    expect(html).toContain(copy.consentWithdraw);
    expect(html).toMatch(
      new RegExp(`<button[^>]*disabled=""[^>]*>${copy.submit}</button>`),
    );
    // The comment's limit and its counter come from the contract.
    expect(html).toContain(`maxLength="${MAX_FEEDBACK_CHARS}"`);
    expect(html).toContain(`0/${MAX_FEEDBACK_CHARS}`);
    expect(html).toContain(copy.addMouse);
  });

  it("is a native modal dialog with its title as the accessible name", () => {
    const html = renderForm();
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="/);
    expect(html).toContain("profile-sheet-page");
    // A full-screen page has no sheet handle.
    expect(html).not.toContain("profile-sheet-handle");
    expect(html).toContain(account.cancel);
  });

  it("with a catalogue mouse: the 1 to 5 control is a labelled radio group with accessible names and end captions", () => {
    const html = renderForm(RATED);
    expect(html).toContain("<fieldset");
    expect(html).toContain(copy.qSatisfaction);
    for (const score of [1, 2, 3, 4, 5]) {
      expect(html).toContain(`aria-label="${copy.satisfactionOption(score)}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    // The chosen score is the real state of its radio.
    expect(html).toMatch(
      /aria-label="滿意度 4 分"[^>]*checked=""|checked=""[^>]*aria-label="滿意度 4 分"/,
    );
    expect(html).toContain(copy.satisfactionLow);
    expect(html).toContain(copy.satisfactionHigh);
    // The end captions are tied to the first and the last option.
    expect(html).toMatch(
      /aria-label="滿意度 1 分"[^>]*aria-describedby="[^"]*-low"/,
    );
    expect(html).toMatch(
      /aria-label="滿意度 5 分"[^>]*aria-describedby="[^"]*-high"/,
    );
    // A score is given: the line that asks for one is gone.
    expect(html).not.toContain(copy.satisfactionNeeded);
  });

  it("asks for a score while a catalogue mouse has none", () => {
    const html = renderForm(
      form({
        current: {
          kind: "rating",
          draft: emptyRatingDraft("razer-deathadder-v3"),
        },
      }),
    );
    expect(html).toContain(copy.satisfactionNeeded);
    expect(html).not.toMatch(/type="radio"[^>]*checked=""/);
  });

  it("chips have real state: aria-pressed on the chosen use time, pain point and main use", () => {
    const html = renderForm(RATED);
    expect(html).toContain(
      `aria-pressed="true">${account.durations["6_to_12_months"]}</button>`,
    );
    expect(html).toContain(
      `aria-pressed="false">${account.durations["1_to_6_months"]}</button>`,
    );
    expect(html).toContain(`aria-pressed="true">${copy.pain.length}</button>`);
    expect(html).toContain(`aria-pressed="false">${copy.pain.width}</button>`);
    expect(html).toContain(
      `aria-pressed="true">${copy.mainUses.gaming}</button>`,
    );
    expect(html).toContain(
      `aria-pressed="false">${copy.mainUses.mixed}</button>`,
    );
    // Use-time labels are the profile page's, five of them.
    for (const label of Object.values(account.durations)) {
      expect(html).toContain(label);
    }
  });

  it("a mouse that is not in the catalogue asks nothing about score, time or what does not fit", () => {
    const html = renderForm(
      form({
        current: {
          kind: "other",
          draft: { ...emptyOtherDraft(), brand: "razer" },
        },
      }),
    );
    expect(html).toContain(account.otherModel("Razer"));
    expect(html).not.toContain(copy.qSatisfaction);
    expect(html).not.toContain(copy.qPain);
  });

  it("enables submit once the consent is ticked and a mouse can be sent", () => {
    const ticked = renderForm({ ...RATED, consent: true });
    expect(ticked).not.toMatch(
      new RegExp(`<button[^>]*disabled=""[^>]*>${copy.submit}</button>`),
    );
    expect(ticked).toMatch(
      /type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/,
    );
    // Consent without a mouse is still off.
    const noMouse = renderForm(form({ consent: true }));
    expect(noMouse).toMatch(
      new RegExp(`<button[^>]*disabled=""[^>]*>${copy.submit}</button>`),
    );
  });

  it("lists the extra mice, each with a button to take it out, and the slots left", () => {
    const html = renderForm(
      form({
        current: {
          kind: "rating",
          draft: { ...emptyRatingDraft("a"), satisfaction: 4 },
        },
        extraRatings: [
          {
            ...emptyRatingDraft("razer-deathadder-v3"),
            satisfaction: 3,
          },
        ],
        extraOther: { brand: "apple", sizeFeel: "small", model: "" },
      }),
    );
    expect(html).toContain("Razer DeathAdder V3");
    expect(html).toContain(account.satisfaction(3));
    expect(html).toContain(account.otherModel("Apple"));
    expect(html).toContain(
      `aria-label="${copy.removeExtra("Razer DeathAdder V3")}"`,
    );
    // Current + two extras = 3 of 5: two slots left.
    expect(html).toContain(copy.othersHint(2));
  });

  it("draws no add button when the body is full", () => {
    const full = form({
      current: { kind: "rating", draft: emptyRatingDraft("a") },
      extraRatings: ["b", "c", "d", "e"].map((s) => emptyRatingDraft(s)),
    });
    const html = renderForm(full);
    expect(html).not.toContain(copy.addMouse);
    expect(html).toContain(copy.othersHint(0));
  });
});

describe("the mouse picker", () => {
  const render = (props: Partial<Parameters<typeof MouseChoiceFlow>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(MouseChoiceFlow, {
        catalogue: CATALOGUE,
        chosenSlugs: [],
        allowOther: true,
        onChoose: noop,
        onClose: noop,
        ...props,
      }),
    );

  it("opens as a tall sheet: a search box, a brand row with 「全部」 first and pressed, and the list", () => {
    const html = render();
    expect(html).toContain("profile-sheet-tall");
    expect(html).toContain(copy.pickerTitle);
    expect(html).toContain(`placeholder="${copy.searchPlaceholder}"`);
    expect(html).toContain(`aria-label="${copy.brandFilterLabel}"`);
    expect(html).toContain(`aria-pressed="true">${copy.brandAll}</button>`);
    expect(html.indexOf(copy.brandAll)).toBeLessThan(html.indexOf("Logitech"));
    // Brands with the most mice come first: Logitech has two.
    expect(html.indexOf(`aria-pressed="false">Logitech</button>`)).toBeLessThan(
      html.indexOf(`aria-pressed="false">Razer</button>`),
    );
  });

  it("lists every mouse it is given with the brand above the model, sorted, and nothing else", () => {
    const html = render();
    const brand = (b: string, m: string) =>
      `<span class="qn-choice-brand">${b}</span><span class="qn-choice-model">${m}</span>`;
    for (const row of CATALOGUE)
      expect(html).toContain(brand(row.brand, row.model));
    expect(html.match(/class="qn-choice"/g)).toHaveLength(CATALOGUE.length);
    expect(html.indexOf("G Pro X Superlight 2")).toBeLessThan(
      html.indexOf("DeathAdder V3"),
    );
  });

  it("marks the chosen mouse with a check that is also spoken, not by colour", () => {
    const html = render({ chosenSlugs: ["razer-deathadder-v3"] });
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain(copy.chosen);
    expect(html).toContain("qn-check");
  });

  it("keeps the 「找不到？選「其他」」 row visible in the footer, and draws it only when 「其他」 is allowed", () => {
    expect(render()).toContain(copy.notFoundOther);
    expect(render()).toContain("profile-sheet-footer");
    expect(render({ allowOther: false })).not.toContain(copy.notFoundOther);
  });

  it("an empty catalogue says so instead of an empty list", () => {
    const html = render({ catalogue: [] });
    expect(html).toContain(copy.noResults);
    expect(html).not.toContain('class="qn-choice"');
  });
});

describe("the sheet for a mouse that is not in the catalogue", () => {
  const render = (showModelField?: boolean) =>
    renderToStaticMarkup(
      createElement(OtherMouseSheet, {
        initial: emptyOtherDraft(),
        showModelField: showModelField ?? false,
        onDone: noop,
        onBack: noop,
        onClose: noop,
      }),
    );

  it("has the brand drop-down over the contract's brands, the three-way size feel, 「完成」 and 「改從清單選」", () => {
    const html = render();
    expect(html).toContain(copy.otherTitle);
    expect(html.match(/<option /g)).toHaveLength(OTHER_MOUSE_BRANDS.length);
    expect(html).toContain(account.otherBrand);
    expect(html).toContain(`>${copy.sizeFeels.small}</button>`);
    expect(html).toContain(
      `aria-pressed="true">${copy.sizeFeels.just_right}</button>`,
    );
    expect(html).toContain(copy.otherDone);
    expect(html).toContain(copy.backToList);
  });

  it("the model field is behind a prop: absent by default, present when switched on", () => {
    expect(render()).not.toContain(copy.modelLabel);
    expect(render(true)).toContain(copy.modelLabel);
    expect(render(true)).toContain(`placeholder="${copy.modelPlaceholder}"`);
  });
});

describe("the edit sheet", () => {
  const rating = {
    slug: "logitech-g-pro-x-superlight-2",
    satisfaction: 4,
    duration: "6_to_12_months" as const,
    painPoints: ["length" as const],
    current: true,
  };
  const render = (props: Partial<Parameters<typeof RatingSheet>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(RatingSheet, {
        title: "Logitech G Pro X Superlight 2",
        initial: {
          slug: rating.slug,
          satisfaction: rating.satisfaction,
          duration: rating.duration,
          painPoints: rating.painPoints,
        },
        initialCurrent: true,
        showCurrent: true,
        working: false,
        line: null,
        onSave: noop,
        onRemove: noop,
        onClose: noop,
        ...props,
      }),
    );

  it("shows the name, the note, the answers as they are, the current switch and the red remove row", () => {
    const html = render();
    expect(html).toContain("Logitech G Pro X Superlight 2");
    expect(html).toContain(copy.editNote);
    expect(html).toContain(copy.satisfactionLegend);
    expect(html).toMatch(
      /aria-label="滿意度 4 分"[^>]*checked=""|checked=""[^>]*aria-label="滿意度 4 分"/,
    );
    expect(html).toContain(
      `aria-pressed="true">${account.durations["6_to_12_months"]}</button>`,
    );
    expect(html).toContain(`aria-pressed="true">${copy.pain.length}</button>`);
    expect(html).toMatch(
      /role="switch"[^>]*checked=""|checked=""[^>]*role="switch"/,
    );
    expect(html).toContain(copy.isCurrent);
    expect(html).toContain(copy.removeMouse);
  });

  it("pins 「儲存」 in a footer under a scrolling body, so the body and the button are apart", () => {
    const html = render();
    expect(html).toContain("profile-sheet-pinned");
    expect(html.indexOf("profile-sheet-body")).toBeLessThan(
      html.indexOf("profile-sheet-footer"),
    );
    expect(html.indexOf(copy.removeMouse)).toBeLessThan(
      html.indexOf("profile-sheet-footer"),
    );
    expect(html.indexOf(account.save)).toBeGreaterThan(
      html.indexOf("profile-sheet-footer"),
    );
  });

  it("leaves Save off with no score, while working, and when the set is over the cap", () => {
    const off = (html: string) =>
      new RegExp(
        `<button[^>]*disabled=""[^>]*>${account.save}|disabled=""[^>]*>${account.saving}`,
      ).test(html);
    expect(off(render())).toBe(false);
    expect(off(render({ initial: emptyRatingDraft("a") }))).toBe(true);
    expect(off(render({ working: true }))).toBe(true);
    expect(off(render({ blocked: true }))).toBe(true);
  });

  it("says why in one line when it cannot save", () => {
    const html = render({ line: copy.overCap(30), blocked: true });
    expect(html).toContain(copy.overCap(30));
    expect(html).toContain('role="status"');
  });

  it("draws no remove row when the mouse cannot be removed, and no switch in the form", () => {
    expect(render({ onRemove: undefined })).not.toContain(copy.removeMouse);
    expect(render({ showCurrent: false })).not.toContain(copy.isCurrent);
  });

  it("a mouse that is not in the catalogue edits only its size feel and the current switch", () => {
    const html = renderToStaticMarkup(
      createElement(OtherMouseEditSheet, {
        title: copy.otherEditTitle("Zowie"),
        initialSizeFeel: "large",
        initialCurrent: false,
        working: false,
        line: null,
        onSave: noop,
        onRemove: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain(
      `aria-pressed="true">${copy.sizeFeels.large}</button>`,
    );
    expect(html).toContain(copy.isCurrent);
    expect(html).not.toContain(copy.satisfactionLegend);
    expect(html).toContain(copy.removeMouse);
  });

  it("the sheets for the main use and the comment", () => {
    const base = {
      initialMainUse: "office" as const,
      initialFeedback: "手感偏小",
      working: false,
      line: null,
      onSave: noop,
      onClose: noop,
    };
    const mainUse = renderToStaticMarkup(
      createElement(OtherAnswerSheet, { ...base, field: "mainUse" }),
    );
    expect(mainUse).toContain(copy.mainUseTitle);
    expect(mainUse).toContain(
      `aria-pressed="true">${copy.mainUses.office}</button>`,
    );
    const feedback = renderToStaticMarkup(
      createElement(OtherAnswerSheet, { ...base, field: "feedback" }),
    );
    expect(feedback).toContain(copy.feedbackTitle);
    expect(feedback).toContain("手感偏小");
    expect(feedback).toContain(`maxLength="${MAX_FEEDBACK_CHARS}"`);
    expect(feedback).toContain(`4/${MAX_FEEDBACK_CHARS}`);
    expect(feedback).toContain(copy.feedbackNote);
  });
});

describe("the removal confirmation", () => {
  const html = renderToStaticMarkup(
    createElement(RemoveConfirm, {
      name: "Logitech G Pro X Superlight 2",
      working: false,
      line: null,
      onConfirm: noop,
      onClose: noop,
    }),
  );

  it("is an alert dialog that names the mouse and says it cannot be undone", () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain('aria-describedby="');
    expect(html).toContain(copy.removeTitle);
    expect(html).toContain("Logitech G Pro X Superlight 2。移除後無法復原。");
  });

  it("offers 「移除」 and 「取消」, with 「取消」 last, as its own card", () => {
    expect(html.indexOf(`>${copy.removeConfirm}</button>`)).toBeLessThan(
      html.indexOf(`>${account.cancel}</button>`),
    );
    expect(html).toContain("qn-confirm-cancel");
    expect(html).toContain("qn-confirm-remove");
  });

  it("shows no always-on focus ring: no inline outline, and no autofocus attribute that would paint one", () => {
    expect(html).not.toContain("outline");
    expect(html).not.toContain("autofocus");
  });
});

describe("the profile page with the questionnaire wired", () => {
  const answers: AnswersState = {
    kind: "ready",
    answers: surveyMineResponseSchema.parse({
      mainUse: "gaming",
      feedback: "手感偏小",
      otherMice: [{ brand: "zowie", sizeFeel: "large", current: false }],
      ratings: [
        {
          slug: "razer-deathadder-v3",
          satisfaction: 3,
          duration: "1_to_3_years",
          painPoints: [],
          current: false,
        },
        {
          slug: "logitech-g-pro-x-superlight-2",
          satisfaction: 4,
          duration: "6_to_12_months",
          painPoints: [],
          current: true,
        },
      ],
    }),
  };
  const empty: AnswersState = {
    kind: "ready",
    answers: surveyMineResponseSchema.parse({
      mainUse: null,
      feedback: null,
      otherMice: [],
      ratings: [],
    }),
  };
  const scan = {
    scanId: SCAN,
    createdAt: "2026-10-12T02:00:00.000Z",
    hand: "right" as const,
    gripStyleStated: null,
    palmThicknessStated: null,
    measurements: {
      handLengthMm: 186,
      palmLengthMm: 100,
      palmWidthMm: 89,
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
  };
  const render = (initialAnswers: AnswersState) =>
    renderToStaticMarkup(
      createElement(SignedInProfile, {
        scans: [scan],
        mouseNames: NAMES,
        catalogue: CATALOGUE,
        initialAnswers,
      }),
    );

  it("every mouse row, the add button and the other answers are buttons now (no dead text)", () => {
    const html = render(answers);
    expect(html).toContain("profile-host");
    for (const name of [
      "Razer DeathAdder V3",
      "Logitech G Pro X Superlight 2",
    ]) {
      expect(html).toMatch(
        new RegExp(
          `<button[^>]*profile-mouse[^>]*>(?:(?!</button>).)*${name}`,
          "s",
        ),
      );
    }
    expect(html).toContain(account.addMouse);
    expect(html).toMatch(
      new RegExp(`<button[^>]*>(?:(?!</button>).)*${account.mainUseRow}`, "s"),
    );
    // The use time reads the same here and in the form.
    expect(html).toContain(account.used(account.durations["6_to_12_months"]));
  });

  it("the empty state's button opens the questionnaire, named 「我的滑鼠」", () => {
    const html = render(empty);
    expect(html).toMatch(
      new RegExp(
        `<button[^>]*profile-primary[^>]*>${account.answerQuestionnaire}</button>`,
      ),
    );
  });

  it("the nickname and avatar sheets stay unwired: no `editing` is passed", () => {
    const html = render(answers);
    expect(html).toContain(account.nicknameRow);
    expect(html).not.toContain(account.notWired);
  });
});

describe("the signed-out link", () => {
  it("a visitor with a scan in this browser gets a button that opens the form", () => {
    const html = renderToStaticMarkup(
      createElement(AnonymousAnswerLink, { scanId: SCAN, onOpen: noop }),
    );
    expect(html).toContain("<button");
    expect(html).toContain(account.answerWithoutAccount);
    expect(html).not.toContain("/scan/easy");
  });

  it("with no scan it goes to /scan/easy", () => {
    const html = renderToStaticMarkup(
      createElement(SignedOutAnswer, {
        scanId: null,
        catalogue: CATALOGUE,
        mouseNames: NAMES,
      }),
    );
    expect(html).toContain('href="/scan/easy"');
    expect(html).not.toContain("<dialog");
  });

  it("with a scan, the wrapper shows the button and no form until it is pressed", () => {
    const html = renderToStaticMarkup(
      createElement(SignedOutAnswer, {
        scanId: SCAN,
        catalogue: CATALOGUE,
        mouseNames: NAMES,
      }),
    );
    expect(html).toContain("<button");
    expect(html).not.toContain("<dialog");
  });
});
