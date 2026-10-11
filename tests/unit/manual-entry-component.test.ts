import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ManualEntryHandle,
  ManualEntrySheet,
} from "../../src/components/scan/ManualEntrySheet";

const noop = () => {};

describe("the manual-entry panel (desktop presentation, first render)", () => {
  const html = renderToStaticMarkup(
    createElement(ManualEntrySheet, {
      presentation: "panel",
      onUse: noop,
    }),
  );

  it("is a labelled section with the form inline, not a dialog", () => {
    expect(html).toContain("<section");
    expect(html).toContain("aria-labelledby=");
    expect(html).not.toContain("<dialog");
    expect(html).toContain("輸入手的尺寸");
  });

  it("has visible labels, decimal keyboards and a unit for both numbers", () => {
    expect(html).toContain("手長");
    expect(html).toContain("手寬");
    expect([
      ...html.matchAll(/inputMode="decimal"|inputmode="decimal"/g),
    ]).toHaveLength(2);
    expect(html).toContain("手腕橫紋到中指指尖");
    expect(html).toContain("四指根部關節處，手掌最寬的地方");
    expect([...html.matchAll(/公分/g)].length).toBeGreaterThanOrEqual(2);
  });

  it("offers both hands, neither chosen: there is no default hand", () => {
    expect(html).toContain("左手");
    expect(html).toContain("右手");
    expect(html).toContain('type="radio"');
    expect(html).not.toContain("checked");
  });

  it("starts with the use button disabled and no error showing", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(html).toContain("使用這組數字");
    expect(html).not.toContain("manualEntry-error");
  });

  it("has no cancel button unless the parent gives one", () => {
    expect(html).not.toContain("取消");
    const withCancel = renderToStaticMarkup(
      createElement(ManualEntrySheet, {
        presentation: "panel",
        onUse: noop,
        onCancel: noop,
      }),
    );
    expect(withCancel).toContain("取消");
  });

  it("preselects only a hand the parent passes in", () => {
    const html2 = renderToStaticMarkup(
      createElement(ManualEntrySheet, {
        presentation: "panel",
        onUse: noop,
        initialHand: "left",
      }),
    );
    expect([...html2.matchAll(/checked/g)]).toHaveLength(1);
  });
});

describe("the entry handle", () => {
  const html = renderToStaticMarkup(
    createElement(ManualEntryHandle, { onOpen: noop }),
  );

  it("is one button that opens a dialog, named for what it does", () => {
    expect(html).toMatch(/^<button/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("改用輸入數字");
    expect(html).toContain('type="button"');
  });
});
