import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// error.tsx reads the router; there is no router outside the app.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import ErrorPage from "../../src/app/error";
import GlobalError from "../../src/app/global-error";
import NotFound, { metadata } from "../../src/app/not-found";
import {
  ACTIONS,
  ERROR_COPY,
  GLOBAL_ERROR_COPY,
  NOT_FOUND_COPY,
} from "../../src/components/errors/copy";
import { retry } from "../../src/components/errors/retry";

/**
 * The not-found and error screens: one <main>, one <h1>, the ways out, and
 * nothing about the failure but its digest.
 */
const count = (html: string, pattern: RegExp) =>
  (html.match(pattern) ?? []).length;

const leaky = Object.assign(
  new Error("SECRET-MESSAGE could not open /srv/app/internal/secret-path.ts"),
  { digest: "1234567890" },
);
leaky.stack =
  "Error: SECRET-MESSAGE\n    at boom (/srv/app/internal/secret-path.ts:3:9)";
const NEVER_SHOWN = [
  "SECRET-MESSAGE",
  "/srv/app",
  "secret-path",
  "boom",
  "    at ",
  "Error:",
];

const structure = (html: string) => {
  expect(count(html, /<main[\s>]/g)).toBe(1);
  expect(count(html, /<h1[\s>]/g)).toBe(1);
  expect(html).toContain(`href="/scan/easy"`);
  expect(html).toContain(`href="/"`);
  expect(html).toContain(ACTIONS.scan);
  expect(html).toContain(ACTIONS.home);
};

describe("not-found screen", () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it("has one <main>, one <h1> and links home and to the scan", () => {
    structure(html);
    expect(html).toContain(NOT_FOUND_COPY.title);
  });

  it("puts the scan first: it is the way forward", () => {
    expect(html.indexOf(ACTIONS.scan)).toBeLessThan(html.indexOf(ACTIONS.home));
  });

  it("sets a title of its own and stays out of search results", () => {
    expect(metadata.title).toBe(NOT_FOUND_COPY.pageTitle);
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("names only the page: the root layout's template adds the site name", () => {
    expect(metadata.title).toBe("Page not found");
    expect(String(metadata.title)).not.toContain("Open_Mouse");
  });
});

describe("error screen (error.tsx)", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorPage, { error: leaky, reset: () => {} }),
  );

  it("has one <main>, one <h1>, links home and to the scan, and a Try again button", () => {
    structure(html);
    expect(html).toContain(ERROR_COPY.title);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
  });

  it("shows the digest as a reference, and nothing else about the error", () => {
    expect(html).toContain("Reference");
    expect(html).toContain("<code>1234567890</code>");
    for (const text of NEVER_SHOWN) expect(html).not.toContain(text);
  });

  it("shows no reference at all when there is no digest", () => {
    const withoutDigest = renderToStaticMarkup(
      createElement(ErrorPage, {
        error: new Error("SECRET-MESSAGE"),
        reset: () => {},
      }),
    );
    expect(withoutDigest).not.toContain("Reference");
    expect(withoutDigest).not.toContain("SECRET-MESSAGE");
  });
});

describe("global error screen (global-error.tsx)", () => {
  const html = renderToStaticMarkup(
    createElement(GlobalError, { error: leaky, reset: () => {} }),
  );

  it("brings its own <html> and <body>, because the root layout is gone", () => {
    expect(html.startsWith(`<html lang="en">`)).toBe(true);
    expect(count(html, /<body[\s>]/g)).toBe(1);
    // The full title, site name included: no layout template reaches this page.
    expect(html).toContain(`<title>${GLOBAL_ERROR_COPY.documentTitle}</title>`);
    expect(GLOBAL_ERROR_COPY.documentTitle).toBe(
      "Something went wrong — Open_Mouse",
    );
  });

  it("has one <main>, one <h1>, links home and to the scan, and a Try again button", () => {
    structure(html);
    expect(html).toContain(GLOBAL_ERROR_COPY.title);
    expect(html).toContain(">Try again</button>");
  });

  it("shows the digest and nothing else about the error", () => {
    expect(html).toContain("<code>1234567890</code>");
    for (const text of NEVER_SHOWN) expect(html).not.toContain(text);
  });

  it("carries its own styling hook, since globals.css is not loaded here", () => {
    expect(html).toContain(`<body class="errorBody">`);
  });
});

describe("the Try again button", () => {
  it("refreshes the route and calls reset(), both inside one transition", () => {
    const order: string[] = [];
    retry({
      reset: () => order.push("reset"),
      refresh: () => order.push("refresh"),
      startTransition: (callback) => {
        order.push("start");
        callback();
      },
    });
    expect(order).toEqual(["start", "refresh", "reset"]);
  });

  it("does nothing until the transition runs its callback", () => {
    const reset = vi.fn();
    const refresh = vi.fn();
    retry({ reset, refresh, startTransition: () => {} });
    expect(reset).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("calls reset() exactly once", () => {
    const reset = vi.fn();
    retry({ reset, refresh: () => {}, startTransition: (cb) => cb() });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
