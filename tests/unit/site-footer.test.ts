import { readFileSync } from "node:fs";
import nodePath from "node:path";
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
  FOOTER_HEADLINE,
} from "../../src/lib/copy/site-footer";
import { en as shareEn, zhTW as shareZh } from "../../src/lib/copy/share-card";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { GITHUB_URL, SITE_NAME, SITE_URL } from "../../src/lib/site";

function render(at: string | null): string {
  path.current = at;
  return renderToStaticMarkup(createElement(SiteFooter));
}

describe("SiteFooter", () => {
  it("is English on the server render, with the name, the headline and the six links in three groups", () => {
    const html = render("/");
    expect(html).toContain(SITE_NAME);
    expect(html).toContain("Ready to Find Yours?");
    const links = [
      ...html.matchAll(
        /<a[^>]*href="([^"]+)"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)<\/a>/g,
      ),
    ].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ["/scan/easy", "Scan"],
      ["/learn", "Learn"],
      ["/how-it-works", "How it works"],
      ["/how-it-works#privacy", "Privacy"],
      ["/account", "Account"],
      [GITHUB_URL, "GitHub"],
    ]);
    const titles = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(titles).toEqual(["Product", "Trust", "Project"]);
    // The page is lang="en": nothing on the English render claims zh-TW.
    expect(html).not.toContain('lang="zh-TW"');
  });

  it("carries no explanatory text: no Early preview note, no non-affiliation statement (Kirby, 2026-10-10)", () => {
    const html = render("/");
    expect(html).not.toMatch(/Early preview/i);
    expect(html).not.toMatch(/affiliated/i);
    expect(html).not.toMatch(/Logitech/);
    for (const table of [footerZh, footerEn])
      expect(Object.keys(table)).not.toContain("preview");
  });

  it("puts GitHub last, in the Project group, as the only external link with rel", () => {
    const html = render("/");
    expect(html).toContain(`href="${GITHUB_URL}" rel="noopener noreferrer"`);
    expect(html.match(/<a [^>]*rel="/g)).toHaveLength(1);
    expect(html.lastIndexOf("GitHub")).toBeGreaterThan(html.indexOf("Account"));
  });

  it("has an empty, hidden mount for the later star field, and a hidden mark", () => {
    const html = render("/");
    expect(html).toContain(
      'class="siteFooter-backdrop" data-testid="site-footer-backdrop" aria-hidden="true"></div>',
    );
    expect(html).toContain('src="/images/brand/palmate-mark.svg"');
    expect(html).toContain('alt=""');
  });

  it("draws the mark's hand with the official 1.4-unit stroke, and the dot as before", () => {
    const svg = readFileSync(
      nodePath.resolve(__dirname, "../../public/images/brand/palmate-mark.svg"),
      "utf8",
    );
    expect(svg).toMatch(/stroke="#7FA8FF" stroke-width="1\.4"/);
    expect(svg).not.toContain('stroke-width="1.7"');
    // The dot is not touched (BRAND-1 changes the hand's line only).
    expect(svg).toContain(
      '<circle cx="45" cy="53.5" r="1.15" fill="#CFE0FF" stroke="#2463EB" stroke-width="0.8"/>',
    );
  });

  it("points the GitHub link at the public repository", () => {
    expect(GITHUB_URL).toBe("https://github.com/kirbyliu99M/Open_Mouse");
    expect(render("/")).toContain(`href="${GITHUB_URL}"`);
  });

  it("keeps Kirby's headline word for word, outside the language tables", () => {
    expect(FOOTER_HEADLINE).toBe("Ready to Find Yours?");
    for (const table of [footerZh, footerEn])
      expect(Object.values(table)).not.toContain(FOOTER_HEADLINE);
  });

  it("has the same strings in both languages and none that is empty", () => {
    expect(Object.keys(footerZh).sort()).toEqual(Object.keys(footerEn).sort());
    expect(Object.keys(shareZh).sort()).toEqual(Object.keys(shareEn).sort());
    for (const table of [footerZh, footerEn])
      for (const v of Object.values(table)) expect(v.length).toBeGreaterThan(0);
    expect(footerZh.howItWorks).toBe("運作方式");
    expect(footerZh.privacy).toBe("隱私");
    expect(footerZh.account).toBe("帳號");
    // New in the merged footer: candidates (未拍板).
    expect(footerZh.groupProduct).toBe("產品");
    expect(footerZh.groupTrust).toBe("信任");
    expect(footerZh.groupProject).toBe("專案");
    expect(footerZh.scan).toBe("掃描");
    expect(footerZh.learn).toBe("學習");
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
      FOOTER_HEADLINE,
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
