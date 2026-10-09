import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The footer reads the path; there is no router outside the app.
const path = vi.hoisted(() => ({ current: "/" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

import { SiteFooter, showsSiteFooter } from "../../src/components/SiteFooter";
import {
  en as footerEn,
  zhTW as footerZh,
  NON_AFFILIATION_STATEMENT,
} from "../../src/lib/copy/site-footer";
import { en as shareEn, zhTW as shareZh } from "../../src/lib/copy/share-card";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "../../src/lib/site";

function render(at: string | null): string {
  path.current = at;
  return renderToStaticMarkup(createElement(SiteFooter));
}

describe("SiteFooter", () => {
  it("is English on the server render, with the four links and the site name", () => {
    const html = render("/");
    expect(html).toContain(SITE_NAME);
    expect(html).toContain(
      "Early preview · measurements are still being validated",
    );
    const links = [
      ...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g),
    ].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/how-it-works", "How it works"],
      ["/how-it-works#privacy", "Privacy"],
      ["/account", "Account"],
      [GITHUB_URL, "GitHub"],
    ]);
    // The page is lang="en": nothing on the English render claims zh-TW.
    expect(html).not.toContain('lang="zh-TW"');
  });

  it("points the GitHub link at the public repository", () => {
    expect(GITHUB_URL).toBe("https://github.com/kirbyliu99M/Open_Mouse");
    expect(render("/")).toContain(`href="${GITHUB_URL}"`);
  });

  it("keeps the home page's non-affiliation wording word for word", () => {
    expect(NON_AFFILIATION_STATEMENT).toBe(
      "Not affiliated with Logitech. Sizes from Logitech's published specs.",
    );
    // The markup escapes the apostrophe; the text is the same.
    expect(render("/")).toContain(
      "Not affiliated with Logitech. Sizes from Logitech&#x27;s published specs.",
    );
  });

  it("has the same strings in both languages and none that is empty", () => {
    expect(Object.keys(footerZh).sort()).toEqual(Object.keys(footerEn).sort());
    expect(Object.keys(shareZh).sort()).toEqual(Object.keys(shareEn).sort());
    for (const table of [footerZh, footerEn])
      for (const v of Object.values(table)) expect(v.length).toBeGreaterThan(0);
    expect(footerZh.preview).toBe("Early preview · 量測仍在驗證中");
    expect(footerZh.howItWorks).toBe("運作方式");
    expect(footerZh.privacy).toBe("隱私");
    expect(footerZh.account).toBe("帳號");
  });

  it("is absent on the print pages and the capture flow, present elsewhere", () => {
    for (const p of [
      "/learn/print",
      "/learn/slates",
      "/sheet",
      "/scan",
      "/scan/easy",
      "/scan/share-card-demo",
    ]) {
      expect(showsSiteFooter(p), p).toBe(false);
      expect(render(p), p).toBe("");
    }
    for (const p of [
      "/",
      "/how-it-works",
      "/account",
      "/results/demo",
      "/results/abc",
      "/learn",
      "/learn/check",
      "/sheets",
      "/scanner",
      "/no-such-page",
    ]) {
      expect(showsSiteFooter(p), p).toBe(true);
    }
    expect(showsSiteFooter(null)).toBe(true);
  });
});

describe("candidate copy", () => {
  it("makes no medical claim and states no number (footer, share card)", () => {
    const strings = [
      ...Object.values(footerZh),
      ...Object.values(footerEn),
      ...[shareZh, shareEn].flatMap((c) => [
        c.kicker,
        ...Object.values(c.size),
        ...Object.values(c.grip),
        ...Object.values(c.width),
        c.topPickLabel,
        c.scoreLabel,
        c.tagline,
        c.buttonLink,
        c.buttonPrimary,
        c.busy,
        c.error,
        ...(["small", "medium", "large"] as const).flatMap((size) =>
          (["slim", "wide"] as const).map((width) =>
            c.sentence({ size, grip: "claw", width }),
          ),
        ),
      ]),
    ];
    for (const s of strings) {
      expect(findMedicalClaimTerm(s), s).toBeNull();
      expect(s, s).not.toMatch(/\d/);
    }
  });

  it("describes the mouse in the sentence, never the hand or other people", () => {
    for (const c of [shareZh, shareEn]) {
      for (const size of ["small", "medium", "large"] as const) {
        for (const width of ["slim", "wide"] as const) {
          const s = c.sentence({ size, grip: "palm", width });
          expect(s).not.toMatch(
            /你的手|your hand|多數人|別人|most people|average|平均|better than/i,
          );
        }
      }
    }
  });

  it("names the site and its address in one place", () => {
    expect(SITE_NAME).toBe("Palmate");
    expect(SITE_URL).toBe("https://open-mouse.vercel.app");
  });
});
