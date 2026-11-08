/**
 * Error photos (candidate 未拍板; src/lib/contracts/error-photo.ts) in a real
 * browser: the link on the result sheet, the consent sheet, and what reaches
 * `POST /api/error-photos`, which is mocked here (page.route: no Blob store,
 * no database).
 *
 * Runs only on a build with `NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1` (the
 * playwright.config.ts webServer passes it through), and only on the
 * fake-camera project (paper-edge-full.y4m): `/scan/easy/live-measured-demo`
 * is the real camera screen with a pipeline that answers "measured" (or,
 * with `?result=retake`, a hand problem) for a REAL captured frame, so the
 * photo the sheet prepares is a real JPEG from the camera.
 *
 *   NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1 PLAYWRIGHT_PORT=3217 \
 *     npx playwright test error-photo-dialog --project=chromium-camera-paper-edge
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { errorPhotoCopy } from "../../src/lib/copy/error-photo";
import { scanCommonCopy } from "../../src/lib/copy/scan-common";
import { inspectJpeg } from "../../src/lib/error-photo/jpeg";
import type { Locale } from "../../src/lib/contracts/locale";
import { dismissFirstRun } from "./fixtures/first-run";

const ON = process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1";
const LIVE_DEMO = "/scan/easy/live-measured-demo";
const CODE = /^[A-HJ-NP-Z2-9]{12}$/;

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(!ON, "Needs a build with NEXT_PUBLIC_ERROR_PHOTO_ENABLED=1.");
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

test.describe.configure({ timeout: 90_000 });

interface Part {
  readonly name: string;
  readonly data: Buffer;
}

/** The parts of a multipart/form-data body (enough for these three fields). */
function parseMultipart(body: Buffer, contentType: string): Map<string, Part> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = new Map<string, Part>();
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    // Skip the CRLF after the delimiter; drop the CRLF before the next one.
    const chunk = body.subarray(start + 2, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    const headers = chunk.subarray(0, headerEnd).toString();
    const name = /name="([^"]+)"/.exec(headers)?.[1];
    if (name) parts.set(name, { name, data: chunk.subarray(headerEnd + 4) });
    at = next;
  }
  return parts;
}

interface Upload {
  readonly code: string;
  readonly meta: Record<string, unknown>;
  readonly photo: Buffer;
}

/**
 * Answers every `POST /api/error-photos` with what `answer` says for the
 * n-th request (1-based): a status after an optional delay, or `"never"`.
 */
async function mockUploads(
  page: Page,
  answer: (n: number) => { status: number; delayMs?: number } | "never",
) {
  const uploads: Upload[] = [];
  const pending: Route[] = [];
  await page.route("**/api/error-photos", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    const parts = parseMultipart(
      request.postDataBuffer() ?? Buffer.alloc(0),
      request.headers()["content-type"] ?? "",
    );
    const upload: Upload = {
      code: parts.get("code")?.data.toString() ?? "",
      meta: JSON.parse(parts.get("meta")?.data.toString() ?? "{}"),
      photo: parts.get("photo")?.data ?? Buffer.alloc(0),
    };
    uploads.push(upload);
    const a = answer(uploads.length);
    if (a === "never") {
      pending.push(route);
      return;
    }
    if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
    await route
      .fulfill({
        status: a.status,
        contentType: "application/json",
        body: JSON.stringify(
          a.status === 201 || a.status === 200
            ? { deleteCode: upload.code }
            : { error: "mocked" },
        ),
      })
      .catch(() => {
        // The page gave up on it (aborted): nothing to answer.
      });
  });
  return {
    uploads,
    /** Answers whatever is still hanging, so the page can close cleanly. */
    async release() {
      for (const route of pending.splice(0))
        await route.abort().catch(() => {});
    },
  };
}

/**
 * Records the result sheet's content height on every DOM change from the
 * moment it appears, and the link's state each time: a row reserved from the
 * first render keeps the height constant while the link becomes ready.
 */
async function watchSheetHeight(page: Page) {
  await page.addInitScript(() => {
    const samples: { height: number; link: string }[] = [];
    (window as Window & { __sheetSamples?: typeof samples }).__sheetSamples =
      samples;
    const record = () => {
      const sheet = document.querySelector<HTMLElement>(
        "dialog.easyResultSheet[open]",
      );
      // Only once the sheet has its content (the numbers are drawn).
      if (!sheet || !sheet.querySelector("[data-testid=easy-sheet-numbers]"))
        return;
      const link = sheet.querySelector(
        "[data-testid=error-photo-numbers-wrong],[data-testid=error-photo-send-entry]",
      );
      const state = link
        ? link.getAttribute("aria-disabled") === "true"
          ? "pending"
          : "ready"
        : sheet.querySelector(".errorPhotoLinkGone")
          ? "reserved"
          : "none";
      const height = sheet.scrollHeight;
      const last = samples[samples.length - 1];
      if (!last || last.height !== height || last.link !== state)
        samples.push({ height, link: state });
    };
    new MutationObserver(record).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  });
}
const sheetSamples = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as Window & {
          __sheetSamples?: { height: number; link: string }[];
        }
      ).__sheetSamples ?? [],
  );

/** Opens the camera, lets the auto-shutter take the photo, confirms the frame if asked. */
async function toResultSheet(page: Page, query = "") {
  await page.goto(`${LIVE_DEMO}${query}`);
  await dismissFirstRun(page);
  const confirm = page.getByTestId("paper-adjust-confirm");
  const sheet = page.locator("dialog.easyResultSheet[open]");
  await expect(confirm.or(sheet).first()).toBeVisible({ timeout: 45_000 });
  if (await confirm.isVisible()) await confirm.click();
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  return sheet;
}

async function openErrorSheet(page: Page, locale: Locale) {
  const sheet = await toResultSheet(page);
  await expect(
    sheet.getByText(scanCommonCopy(locale).handMeasured),
  ).toBeVisible();
  const link = sheet.getByTestId("error-photo-numbers-wrong");
  await expect(link).toHaveText(errorPhotoCopy(locale).numbersWrongLink);
  await expect(link).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 15_000,
  });
  await link.click();
  const dialog = page.getByTestId("error-photo-sheet");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("the link on the result sheet", () => {
  test("(1) measured sheet: the link's row is there from the first render, nothing moves when it becomes ready", async ({
    page,
  }) => {
    await watchSheetHeight(page);
    const sheet = await toResultSheet(page);
    await expect(
      sheet.getByTestId("error-photo-numbers-wrong"),
    ).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });
    const samples = await sheetSamples(page);
    test.info().annotations.push({
      type: "sheet samples",
      description: JSON.stringify(samples),
    });
    // From the first render with content, the row is there (reserved,
    // pending or ready, never missing) and the content height never changes.
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) expect(s.link).not.toBe("none");
    expect(samples[samples.length - 1]!.link).toBe("ready");
    expect(new Set(samples.map((s) => s.height)).size).toBe(1);
  });

  test("(1) failure sheet: 「再試一次」 does not move when the link becomes ready", async ({
    page,
  }) => {
    const sheet = await toResultSheet(page, "?result=retake");
    const tryAgain = sheet.getByRole("button", {
      name: scanCommonCopy("en").tryAgain,
    });
    await expect(tryAgain).toBeVisible();
    const link = sheet.getByTestId("error-photo-send-entry");
    await expect(link).toHaveCount(1);
    const offset = () =>
      tryAgain.evaluate((el) => {
        const dialog = el.closest("dialog")!;
        return {
          top:
            el.getBoundingClientRect().top -
            dialog.getBoundingClientRect().top +
            dialog.scrollTop,
          height: dialog.scrollHeight,
        };
      });
    const before = await offset();
    await expect(link).not.toHaveAttribute("aria-disabled", "true", {
      timeout: 15_000,
    });
    await expect(link).toHaveText(errorPhotoCopy("en").sendButton);
    expect(await offset()).toEqual(before);
  });
});

for (const locale of ["en", "zh-TW"] as const) {
  test.describe(`the consent sheet (${locale})`, () => {
    test.use({ locale: locale === "en" ? "en-US" : "zh-TW" });
    const copy = errorPhotoCopy(locale);

    test("(2)(3)(5) consent gates the send; a slow 503 keeps the code and blocks Esc; the retry is stored with the same code and a clean JPEG", async ({
      page,
    }) => {
      const mock = await mockUploads(page, (n) =>
        n === 1 ? { status: 503, delayMs: 1_500 } : { status: 201 },
      );
      const dialog = await openErrorSheet(page, locale);
      await expect(
        dialog.getByRole("heading", { name: copy.title }),
      ).toBeVisible();

      // (2) Send waits for the consent tick.
      const send = dialog.getByTestId("error-photo-send");
      await expect(send).toBeDisabled();
      await dialog.getByLabel(copy.checkbox).check();
      await expect(send).toBeEnabled();

      // (2) The preview is the prepared JPEG itself (a blob: URL of it).
      const preview = dialog.getByRole("img", { name: copy.previewAlt });
      const previewBytes = await preview.evaluate(
        async (img: HTMLImageElement) => {
          const bytes = new Uint8Array(
            await (await fetch(img.src)).arrayBuffer(),
          );
          return {
            src: img.src,
            head: [bytes[0], bytes[1]],
            length: bytes.length,
          };
        },
      );
      expect(previewBytes.src).toMatch(/^blob:/);
      expect(previewBytes.head).toEqual([0xff, 0xd8]);

      // (3) First try: held 1.5 s, then 503.
      await send.click();
      const code = dialog.getByTestId("error-photo-code");
      await expect(code).toHaveText(CODE);
      const shown = (await code.textContent())!;
      await expect(
        dialog.getByRole("button", { name: copy.cancel }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();

      const failure = dialog.getByTestId("error-photo-failure");
      await expect(failure).toBeVisible({ timeout: 10_000 });
      await expect(failure).toHaveAttribute("role", "alert");
      await expect(failure).toContainText(copy.failUnavailable);
      await expect(failure).toContainText(copy.failUncertain);
      await expect(code).toHaveText(shown);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: copy.cancel }),
      ).toBeEnabled();

      // (3) The retry: the same code, answered 201: the sent phase shows it.
      await send.click();
      await expect(
        dialog.getByRole("heading", { name: copy.sentTitle }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(dialog.getByTestId("error-photo-code")).toHaveText(shown);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();

      // (5) What was sent: both tries carried the shown code, the same bytes,
      // a JPEG with no APP1 (Exif/XMP), of the size the metadata states.
      expect(mock.uploads).toHaveLength(2);
      for (const upload of mock.uploads) {
        expect(upload.code).toBe(shown);
        const jpeg = inspectJpeg(new Uint8Array(upload.photo));
        expect(jpeg.ok).toBe(true);
        if (jpeg.ok) {
          expect(jpeg.app1Segments).toBe(0);
          expect(jpeg.trailerBytes).toBe(0);
          expect(jpeg.width).toBe(upload.meta.widthPx);
          expect(jpeg.height).toBe(upload.meta.heightPx);
        }
        expect(upload.meta).toMatchObject({
          trigger: "numbers-wrong",
          reference: "a4",
          measured: { handLengthMm: 190, palmWidthMm: 84 },
        });
        expect(upload.meta).not.toHaveProperty("code");
      }
      expect(mock.uploads[1]!.photo.equals(mock.uploads[0]!.photo)).toBe(true);
      expect(mock.uploads[0]!.photo.length).toBe(previewBytes.length);

      // 「完成」 closes it.
      await dialog.getByRole("button", { name: copy.done }).click();
      await expect(dialog).toBeHidden();
    });
  });
}

test("(4) no answer: after 30 s the code and the timeout alert show, and Esc stays blocked", async ({
  page,
}) => {
  const copy = errorPhotoCopy("en");
  const mock = await mockUploads(page, () => "never");
  const dialog = await openErrorSheet(page, "en");
  await dialog.getByLabel(copy.checkbox).check();
  // The page's clock is faked only now, so the camera ran on real time; the
  // upload's 30 s wait is the first timer it governs.
  await page.clock.install();
  await dialog.getByTestId("error-photo-send").click();
  const code = dialog.getByTestId("error-photo-code");
  await expect(code).toHaveText(CODE);
  await expect(dialog.getByTestId("error-photo-failure")).toHaveCount(0);
  await page.clock.fastForward(29_000);
  await expect(dialog.getByTestId("error-photo-failure")).toHaveCount(0);
  await page.clock.fastForward(1_500);
  const failure = dialog.getByTestId("error-photo-failure");
  await expect(failure).toHaveText(copy.failTimeout);
  await expect(code).toHaveText(mock.uploads[0]!.code);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await mock.release();
});
