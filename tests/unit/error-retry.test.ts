import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// error.tsx reads the router; there is no router outside the app.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import ErrorPage from "../../src/app/error";
import GlobalError from "../../src/app/global-error";
import { ACTIONS, RETRYING } from "../../src/components/errors/copy";
import { ErrorScreen } from "../../src/components/errors/ErrorScreen";
import { RetryButton } from "../../src/components/errors/RetryButton";
import { reloadPage } from "../../src/components/errors/reload";

/**
 * "Try again" on the two error screens. They differ on purpose:
 *  - error.tsx (a page failed, the app router works): refresh the route and
 *    reset(); the button stays focusable while it works.
 *  - global-error.tsx (the root layout failed, the router may be what broke):
 *    reload the whole page. reset() can not recover a server-side failure.
 */
interface Found {
  type: unknown;
  props: Record<string, unknown>;
}

/** Every React element in a returned tree, depth first, without rendering it. */
function elementsIn(node: ReactNode): Found[] {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [
    { type: node.type, props },
    ...elementsIn(props.children as ReactNode),
  ];
}

const globalErrorTree = (reset: () => void) =>
  elementsIn(GlobalError({ error: new Error("x"), reset }));

describe("global error screen: Try again reloads the page", () => {
  it("is a button labelled Try again", () => {
    const button = globalErrorTree(() => {}).find((e) => e.type === "button")!;
    expect(button.props.children).toBe(ACTIONS.retry);
    expect(button.props.type).toBe("button");
  });

  it("calls window.location.reload() when pressed, and not reset()", () => {
    const reload = vi.fn();
    const reset = vi.fn();
    const button = globalErrorTree(reset).find((e) => e.type === "button")!;
    vi.stubGlobal("window", { location: { reload } });
    try {
      (button.props.onClick as () => void)();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reload).toHaveBeenCalledTimes(1);
    // reset() re-renders with the payload it already holds: no recovery here.
    expect(reset).not.toHaveBeenCalled();
  });

  it("reloadPage reloads the window it is given", () => {
    const reload = vi.fn();
    reloadPage({ location: { reload } });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("error screen: Try again while a retry runs", () => {
  const markup = (pending: boolean) =>
    renderToStaticMarkup(
      createElement(RetryButton, { pending, onRetry: () => {} }),
    );
  const DISABLED_ATTRIBUTE = /\sdisabled(=|>|\s)/;

  it("stays focusable: aria-disabled and aria-busy, never the disabled attribute", () => {
    const busy = markup(true);
    expect(busy).toContain('aria-disabled="true"');
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("errorAction-pending");
    expect(busy).not.toMatch(DISABLED_ATTRIBUTE);
    const idle = markup(false);
    expect(idle).toContain('aria-disabled="false"');
    expect(idle).toContain('aria-busy="false"');
    expect(idle).not.toContain("errorAction-pending");
    expect(idle).not.toMatch(DISABLED_ATTRIBUTE);
  });

  it("ignores a press while pending, and retries otherwise", () => {
    const onRetry = vi.fn();
    const press = (pending: boolean) =>
      (
        RetryButton({ pending, onRetry }).props as { onClick: () => void }
      ).onClick();
    press(true);
    expect(onRetry).not.toHaveBeenCalled();
    press(false);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has a status region that is always in the page, empty until a retry runs", () => {
    const idle = renderToStaticMarkup(
      createElement(ErrorPage, { error: new Error("x"), reset: () => {} }),
    );
    expect(idle).toMatch(/<p class="errorScreen-status" role="status"><\/p>/);
  });

  it("says Trying again in that region while it works", () => {
    // Built outside the call: `children` is required by the type, but this
    // is a .ts file and the element takes it as the third argument.
    const props = {
      eyebrow: "e",
      title: "t",
      message: "m",
      status: RETRYING,
    } as Parameters<typeof ErrorScreen>[0];
    const busy = renderToStaticMarkup(
      createElement(ErrorScreen, props, "actions"),
    );
    expect(busy).toContain(`role="status">${RETRYING}</p>`);
  });

  it("the error page uses that button, not a disabled one", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorPage, { error: new Error("x"), reset: () => {} }),
    );
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toMatch(DISABLED_ATTRIBUTE);
  });
});
