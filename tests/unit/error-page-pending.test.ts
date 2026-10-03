import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// error.tsx reads the router; there is no router outside the app.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
// A retry is under way: useTransition reports pending.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useTransition: () => [true, (cb: () => void) => cb()] };
});

import ErrorPage from "../../src/app/error";
import { RETRYING } from "../../src/components/errors/copy";

/**
 * error.tsx wires the transition's `pending` to the button and to the status
 * region. The pieces are tested on their own (error-retry.test.ts); this pins
 * the wiring by rendering the page while a retry is running.
 */
describe("error.tsx while a retry is running", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorPage, { error: new Error("x"), reset: () => {} }),
  );

  it("marks the button busy without disabling it", () => {
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("errorAction-pending");
    expect(html).not.toMatch(/\sdisabled(=|>|\s)/);
  });

  it("announces that it is trying again", () => {
    expect(html).toContain(`role="status">${RETRYING}</p>`);
  });
});
