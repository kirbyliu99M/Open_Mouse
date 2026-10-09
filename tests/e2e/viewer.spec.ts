import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { decodePng } from "./fixtures/png";

/**
 * The 3D size illustration on /results/[scanId] (Builder D).
 *
 * The fit and analysis routes are stubbed with `page.route`, like every other
 * results spec: there is no database in e2e. The measurements route is stubbed
 * the same way. The model files are real unless a test breaks them.
 *
 * Headless Chromium draws WebGL with its software rasteriser, so the tests that
 * need a model check that it really drew (`describe` block "with WebGL"), and
 * say so by skipping when this machine cannot.
 */

const read = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          `../../src/components/results/fixtures/${name}.json`,
          import.meta.url,
        ),
      ),
      "utf-8",
    ),
  );

// The fixture's top pick is the G Pro X Superlight 2 (a mouse with a shell).
const FIT = read("high-confidence");
const SCAN_ID = FIT.scanId as string;
// The other fixture's top pick is a Pulsar mouse, which has no shell.
const FIT_NO_SHELL = read("with-exclusions");
const SCAN_ID_NO_SHELL = FIT_NO_SHELL.scanId as string;

const MEASUREMENTS = (scanId: string, hand: "left" | "right" = "right") => ({
  scanId,
  hand,
  measurements: {
    handLengthMm: 183.4,
    palmLengthMm: 101.2,
    palmWidthMm: 84.7,
    thumbLengthMm: 61.5,
    indexLengthMm: 72.3,
  },
});

const CAPTION =
  "Size illustration, not a contact simulation. The hand is scaled to your measured hand length and palm width.";
const FALLBACK = "3D preview isn't available for this mouse.";

const ANALYSIS = {
  output: {
    headline: "A close match for your palm grip",
    whyTopPick:
      "The top pick's length and grip width both land close to your ideal.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "model",
  cached: false,
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

interface Stub {
  fit?: Record<string, unknown>;
  scanId?: string;
  measurements?: (route: Route) => Promise<void> | void;
}

/** The three routes a results page calls. Returns the paths that were requested. */
async function stubResults(page: Page, stub: Stub = {}) {
  const fit = stub.fit ?? FIT;
  const scanId = stub.scanId ?? SCAN_ID;
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  await page.route(`**/api/scans/${scanId}/fit`, (route) =>
    fulfillJson(route, 200, fit),
  );
  await page.route(`**/api/scans/${scanId}/analysis`, (route) =>
    fulfillJson(route, 200, ANALYSIS),
  );
  await page.route(
    `**/api/scans/${scanId}/measurements`,
    stub.measurements ??
      ((route) => fulfillJson(route, 200, MEASUREMENTS(scanId))),
  );
  return requested;
}

/** Every console error and uncaught error, except the browser's own note about a request the test broke on purpose. */
function watchErrors(
  page: Page,
  allow: (message: ConsoleMessage) => boolean = () => false,
) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !allow(message))
      errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

const region = (page: Page) => page.locator(".viewer");
const box = (page: Page) => page.locator(".viewer-box");

/**
 * The viewer lives in the Details section, which is closed by default; the
 * viewer mounts (and starts to load) only once it has been opened.
 */
async function openDetails(page: Page) {
  const details = page.locator(".results-details");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
}

/** Opens a results page, then its Details section. */
async function gotoResults(page: Page, scanId: string = SCAN_ID) {
  await page.goto(`/results/${scanId}`);
  await openDetails(page);
}

/** Records layout-shift entries with their times, to be read after a state change. */
async function recordShifts(page: Page) {
  await page.addInitScript(() => {
    const shifts: { t: number; v: number; input: boolean }[] = [];
    (window as unknown as Record<string, unknown>).__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as unknown as {
          value: number;
          hadRecentInput: boolean;
        };
        shifts.push({
          t: entry.startTime,
          v: shift.value,
          input: shift.hadRecentInput,
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}
const shiftsAfter = (page: Page, since: number) =>
  page.evaluate(
    (t) =>
      (
        (window as unknown as Record<string, unknown>).__shifts as {
          t: number;
          v: number;
          input: boolean;
        }[]
      )
        .filter((s) => s.t >= t && !s.input)
        .reduce((sum, s) => sum + s.v, 0),
    since,
  );
const now = (page: Page) => page.evaluate(() => performance.now());

/** Where the elements that follow the viewer sit, and how tall the page is. */
async function layoutBelow(page: Page) {
  const heading = page.getByRole("heading", { name: "How it scores" });
  return {
    box: await box(page).boundingBox(),
    below: await heading.boundingBox(),
    scrollHeight: await page.evaluate(
      () => document.documentElement.scrollHeight,
    ),
  };
}

async function hasWebGL(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  });
}

/** Share of a screenshot's pixels brighter than the box's dark fill. */
async function brightShare(locator: Locator): Promise<number> {
  const png = decodePng(await locator.screenshot());
  let bright = 0;
  const pixels = png.width * png.height;
  for (let i = 0; i < pixels; i++) {
    const at = i * png.channels;
    if (Math.max(png.data[at]!, png.data[at + 1]!, png.data[at + 2]!) > 70)
      bright++;
  }
  return bright / pixels;
}

/** Share of pixels that differ clearly between two screenshots of the same box. */
async function differenceShare(a: Buffer, b: Buffer): Promise<number> {
  const pa = decodePng(a);
  const pb = decodePng(b);
  expect([pa.width, pa.height]).toEqual([pb.width, pb.height]);
  let different = 0;
  const pixels = pa.width * pa.height;
  for (let i = 0; i < pixels; i++) {
    const at = i * pa.channels;
    const delta =
      Math.abs(pa.data[at]! - pb.data[at]!) +
      Math.abs(pa.data[at + 1]! - pb.data[at + 1]!) +
      Math.abs(pa.data[at + 2]! - pb.data[at + 2]!);
    if (delta > 30) different++;
  }
  return different / pixels;
}

// ── Fallbacks: the page must stay whole and still ───────────────────────────

test.describe("fallbacks", () => {
  const expectPageIntact = async (page: Page) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "G Pro X Superlight 2" }),
    ).toBeVisible();
    await expect(page.locator(".results-score-model")).toHaveText(
      "G Pro X Superlight 2",
    );
    await expect(
      page.getByRole("heading", { name: "How it scores" }),
    ).toBeVisible();
    await expect(page.locator(".results-analysis")).toBeVisible();
  };

  test("a model request that fails (404) ends in the one calm line, with no layout shift and no error from the page", async ({
    page,
  }) => {
    await recordShifts(page);
    const errors = watchErrors(page, (m) =>
      m.location().url.includes("/models/shells/"),
    );
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await stubResults(page);
    await page.route("**/models/shells/*.glb", async (route) => {
      await released;
      await route.fulfill({ status: 404, body: "not found" });
    });

    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "loading");
    await expect(page.locator(".viewer-caption")).toHaveText(CAPTION);
    // While it loads: a text-less placeholder, and the status line is there but empty.
    await expect(page.locator(".viewer-skeleton")).toBeVisible();
    await expect(page.locator(".viewer-fallback")).toBeEmpty();
    const before = await layoutBelow(page);

    const t = await now(page);
    release();
    await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    // A live region, so the line is announced.
    await expect(page.locator(".viewer-fallback")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.locator(".viewer-skeleton")).toHaveCount(0);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "failed");
    const after = await layoutBelow(page);

    expect(after).toEqual(before);
    expect(await shiftsAfter(page, t)).toBe(0);
    // The caption keeps its space but is not read out or shown.
    await expect(page.locator(".viewer-caption")).toBeHidden();
    await expectPageIntact(page);
    expect(errors).toEqual([]);
  });

  test("a model file that cannot be decoded ends the same way, with no console error at all", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await stubResults(page);
    await page.route("**/models/shells/*.glb", (route) =>
      route.fulfill({
        status: 200,
        contentType: "model/gltf-binary",
        body: "this is not a glb",
      }),
    );
    await gotoResults(page);
    await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    await expectPageIntact(page);
    expect(errors).toEqual([]);
  });

  for (const [name, handler] of [
    [
      "404 (not this caller's scan, or expired)",
      (r: Route) => fulfillJson(r, 404, { error: "Scan not found." }),
    ],
    [
      "429 (rate limited)",
      (r: Route) => fulfillJson(r, 429, { error: "Too many requests." }),
    ],
    [
      "500",
      (r: Route) =>
        fulfillJson(r, 500, { error: "Failed to load measurements." }),
    ],
    [
      "a body that breaks the contract",
      (r: Route) => fulfillJson(r, 200, { scanId: SCAN_ID, hand: "right" }),
    ],
  ] as const) {
    test(`measurements answered with ${name} ends in the calm line and the rest of the page stays`, async ({
      page,
    }) => {
      const errors = watchErrors(page, (m) =>
        m.location().url.includes("/measurements"),
      );
      await stubResults(page, { measurements: handler });
      await gotoResults(page);
      await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
      await expectPageIntact(page);
      expect(errors).toEqual([]);
    });
  }

  test("a mouse with no shell shows the line from the first paint, keeps the box, and downloads nothing", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const requested = await stubResults(page, {
      fit: FIT_NO_SHELL,
      scanId: SCAN_ID_NO_SHELL,
    });
    await gotoResults(page, SCAN_ID_NO_SHELL);
    await expect(page.locator(".results-score-model")).toHaveText(
      "Xlite V3 Mini",
    );
    await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    await expect(region(page)).toHaveAttribute(
      "data-viewer-state",
      "unsupported",
    );
    // The box is the same size as when a model is expected.
    const noShellBox = await box(page).boundingBox();
    expect(noShellBox!.height).toBeGreaterThan(200);
    // Nothing for the viewer: no model, no decoder, no measurements.
    await page.waitForTimeout(500);
    expect(
      requested.filter((p) => /^\/models\/|^\/draco\/|\/measurements$/.test(p)),
    ).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a GPU that throws while the scene is set up ends in the calm line instead of waiting for ever", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      // Some drivers cannot build a shader program (the environment map needs several).
      WebGL2RenderingContext.prototype.createProgram = () => {
        throw new Error("driver says no");
      };
    });
    await stubResults(page);
    await gotoResults(page);
    await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "failed");
    await expect(page.locator(".viewer-host canvas")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("no WebGL ends in the calm line before any model is requested", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null;
        return (original as (...a: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    const requested = await stubResults(page);
    await gotoResults(page);
    await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    await expect(region(page)).toHaveAttribute(
      "data-viewer-state",
      "unsupported",
    );
    await expectPageIntact(page);
    expect(requested.filter((p) => /^\/models\/|^\/draco\//.test(p))).toEqual(
      [],
    );
    expect(errors).toEqual([]);
  });
});

// ── Lazy loading and what other pages carry ─────────────────────────────────

test.describe("loading", () => {
  test("nothing is downloaded until the region is near the viewport", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Hold every observer back until the test says the region is near.
      const callbacks: (() => void)[] = [];
      (window as unknown as Record<string, unknown>).__near = () =>
        callbacks.splice(0).forEach((run) => run());
      window.IntersectionObserver = class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe(target: Element) {
          callbacks.push(() =>
            this.callback(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as unknown as typeof IntersectionObserver;
    });
    const requested = await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "idle");
    await page.waitForTimeout(600);
    expect(
      requested.filter((p) =>
        /^\/models\/|^\/draco\/|\/measurements$|viewer/i.test(p),
      ),
    ).toEqual([]);

    await page.evaluate(() =>
      (window as unknown as { __near: () => void }).__near(),
    );
    await expect
      .poll(() => requested.some((p) => p.endsWith("/measurements")))
      .toBe(true);
    expect(requested.some((p) => p.startsWith("/models/shells/"))).toBe(true);
  });

  test("nothing is downloaded while Details is closed, and the viewer loads once it is opened", async ({
    page,
  }) => {
    const requested = await stubResults(page);
    await page.goto(`/results/${SCAN_ID}`);
    await expect(page.locator(".results-details")).toBeVisible();
    await expect(page.locator(".results-details")).not.toHaveAttribute(
      "open",
      "",
    );
    // Closed: no viewer on the page at all, and nothing requested for it.
    await expect(region(page)).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(
      requested.filter((p) =>
        /^\/models\/|^\/draco\/|\/measurements$|viewer/i.test(p),
      ),
    ).toEqual([]);

    await openDetails(page);
    await expect(region(page)).toHaveCount(1);
    await expect
      .poll(() => requested.some((p) => p.endsWith("/measurements")))
      .toBe(true);
    expect(requested.some((p) => p.startsWith("/models/shells/"))).toBe(true);
  });

  test("the home and scan pages never request the viewer, a model or the decoder", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) =>
      requested.push(new URL(request.url()).pathname),
    );
    for (const path of ["/", "/scan/easy", "/how-it-works"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(
      requested.filter((p) =>
        /^\/models\/|^\/draco\/|mouse-viewer|[/_]three/i.test(p),
      ),
    ).toEqual([]);
  });

  test("a hostile slug in the fit response asks for no file outside /models/shells/", async ({
    page,
  }) => {
    const requested = await stubResults(page);
    for (const slug of [
      "%2e%2e/%2e%2e/manifest",
      "../../draco/draco_decoder",
      "logitech-g309/../../x",
    ]) {
      await page.unroute(`**/api/scans/${SCAN_ID}/fit`);
      await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
        fulfillJson(route, 200, {
          ...FIT,
          results: (FIT.results as { mouse: Record<string, unknown> }[]).map(
            (entry, i) =>
              i === 0 ? { ...entry, mouse: { ...entry.mouse, slug } } : entry,
          ),
        }),
      );
      await gotoResults(page);
      await expect(page.locator(".viewer-fallback")).toHaveText(FALLBACK);
    }
    await page.waitForTimeout(300);
    expect(
      requested.filter((p) => /^\/models\/|^\/draco\/|\.glb/.test(p)),
    ).toEqual([]);
  });
});

// ── With WebGL: a model is on screen and the person can turn it ─────────────

test.describe("with WebGL", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(
      info.project.name !== "chromium",
      "One desktop run is enough for the 3D checks.",
    );
    await page.goto("/");
    test.skip(
      !(await hasWebGL(page)),
      "This machine's headless Chromium has no WebGL.",
    );
  });

  test("draws the shell and the hand, names itself, and shows the caption", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });

    await expect(page.locator(".viewer-host canvas")).toHaveCount(1);
    await expect(page.locator(".viewer-caption")).toHaveText(CAPTION);
    const group = page.getByRole("group", {
      name: /Logitech G Pro X Superlight 2/,
    });
    await expect(group).toHaveAttribute(
      "aria-label",
      /scaled to your measured hand length/,
    );
    await expect(group).toHaveAttribute("tabindex", "0");
    expect(await brightShare(box(page))).toBeGreaterThan(0.01);
    expect(errors).toEqual([]);
  });

  test("the arrow keys turn it, and reduced motion keeps it still until they do", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });

    const first = await box(page).screenshot();
    await page.waitForTimeout(1500);
    const still = await box(page).screenshot();
    expect(await differenceShare(first, still)).toBeLessThan(0.001);

    await box(page).focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const turned = await box(page).screenshot();
    expect(await differenceShare(still, turned)).toBeGreaterThan(0.02);
  });

  test("a drag turns it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    const before = await box(page).screenshot();
    const rect = (await box(page).boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 120,
      rect.y + rect.height / 2 + 20,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(
      await differenceShare(before, await box(page).screenshot()),
    ).toBeGreaterThan(0.02);
  });

  test("without reduced motion it turns by itself at first and has stopped within a few seconds", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    const a = await box(page).screenshot();
    await page.waitForTimeout(400);
    const b = await box(page).screenshot();
    expect(await differenceShare(a, b)).toBeGreaterThan(0.002);

    await page.waitForTimeout(4500);
    const c = await box(page).screenshot();
    await page.waitForTimeout(500);
    const d = await box(page).screenshot();
    expect(await differenceShare(c, d)).toBeLessThan(0.001);
  });

  test("a left-hand scan mirrors the hand and still draws", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubResults(page, {
      measurements: (route) =>
        fulfillJson(route, 200, MEASUREMENTS(SCAN_ID, "left")),
    });
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    expect(await brightShare(box(page))).toBeGreaterThan(0.01);
  });

  test("leaving the page disposes the GL context and leaves no canvas, no error", async ({
    page,
  }) => {
    // Remember every WebGL context the page creates, to ask each one afterwards.
    await page.addInitScript(() => {
      const made: WebGL2RenderingContext[] = [];
      (window as unknown as Record<string, unknown>).__gl = made;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        const context = (original as (...a: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
        if (type === "webgl2" && context)
          made.push(context as WebGL2RenderingContext);
        return context;
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    const errors = watchErrors(page);
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    const contexts = () =>
      page.evaluate(() =>
        (
          (window as unknown as Record<string, unknown>)
            .__gl as WebGL2RenderingContext[]
        ).map((gl) => gl.isContextLost()),
      );
    expect(await contexts()).toEqual([false]);

    // A client-side navigation: the document stays, so only the viewer's own
    // disposal can release the context.
    await page
      .getByRole("link", { name: /Scan again/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/scan\/easy/);
    await expect.poll(contexts).toEqual([true]);
    expect(
      await page.locator("canvas.viewer-canvas, .viewer-host canvas").count(),
    ).toBe(0);
    expect(errors).toEqual([]);
  });

  test("has no WCAG 2.2 AA violations with a model on screen, and none in the fallback", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    const ready = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(
      ready.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" "))}`,
      ),
    ).toEqual([]);

    await page.unroute(`**/api/scans/${SCAN_ID}/measurements`);
    await page.route(`**/api/scans/${SCAN_ID}/measurements`, (r) =>
      fulfillJson(r, 404, { error: "Scan not found." }),
    );
    await gotoResults(page);
    await expect(page.locator(".viewer-fallback")).toBeVisible();
    const fallback = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(
      fallback.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" "))}`,
      ),
    ).toEqual([]);
  });
});

// ── A phone: a horizontal drag turns it, a vertical swipe scrolls the page ───

test.describe("touch", () => {
  test("a horizontal touch drag turns the model and a vertical swipe scrolls the page instead", async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== "mobile", "A phone project only.");
    await page.goto("/");
    test.skip(!(await hasWebGL(page)), "No WebGL on this machine.");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubResults(page);
    await gotoResults(page);
    await expect(region(page)).toHaveAttribute("data-viewer-state", "ready", {
      timeout: 30_000,
    });
    await box(page).scrollIntoViewIfNeeded();
    const rect = (await box(page).boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const swipe = async (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [from],
      });
      for (let i = 1; i <= 10; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: from.x + ((to.x - from.x) * i) / 10,
              y: from.y + ((to.y - from.y) * i) / 10,
            },
          ],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };

    const before = await box(page).screenshot();
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await swipe(centre, { x: centre.x + 110, y: centre.y });
    await page.waitForTimeout(250);
    expect(
      await differenceShare(before, await box(page).screenshot()),
    ).toBeGreaterThan(0.02);

    const scrolled = await page.evaluate(() => window.scrollY);
    await swipe(centre, { x: centre.x, y: centre.y - 140 });
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled);
  });
});
