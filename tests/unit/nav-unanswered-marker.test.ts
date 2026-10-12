import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnansweredMarker } from "../../src/components/nav/UnansweredMarker";
import { en, zhTW } from "../../src/lib/copy/nav";

describe("the menu's profile item", () => {
  it("is named 「我的檔案」 / 'My profile', not 帳號 / Account", () => {
    expect(zhTW.account).toBe("我的檔案");
    expect(en.account).toBe("My profile");
  });

  it("the marker says 尚未填答 in text; the dot alone is hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(UnansweredMarker));
    expect(html).toContain("尚未填答");
    expect(html).toMatch(/<span class="navMenuMarkerDot" aria-hidden="true">/);
    expect(zhTW.unanswered).toBe("尚未填答");
    expect(en.unanswered).toBe("Not answered yet");
  });
});
