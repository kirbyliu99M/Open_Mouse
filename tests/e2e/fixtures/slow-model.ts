import { expect, type Page } from "@playwright/test";

/**
 * The hand detector's model (7.8 MB) is read by the app itself as a stream
 * with a byte count. These tests stand in for a slow connection: an init
 * script replaces `fetch` for the model URL with a Response whose stream the
 * test releases chunk by chunk (`window.__chunkGate`), built from the real
 * file so MediaPipe still gets a real model in the end.
 */
export type Mode =
  "gated" | "gated-no-length" | "steady" | "fail-first" | "passthrough";

export async function slowModel(page: Page, mode: Mode, chunks = 10) {
  await page.addInitScript(
    ({ mode, chunks }) => {
      const w = window as Window & {
        __modelFetches?: number;
        __chunkGate?: number;
        __progressValues?: string[];
        __modelUrls?: string[];
      };
      w.__modelFetches = 0;
      w.__chunkGate =
        mode === "gated" || mode === "gated-no-length" ? 0 : chunks;
      w.__progressValues = [];
      w.__modelUrls = [];
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        if (!url.includes("hand_landmarker.task"))
          return realFetch(input, init);
        w.__modelFetches = (w.__modelFetches ?? 0) + 1;
        w.__modelUrls!.push(url);
        if (mode === "fail-first" && w.__modelFetches === 1)
          throw new TypeError("offline");
        if (
          mode === "passthrough" ||
          (mode === "fail-first" && w.__modelFetches > 1)
        )
          return realFetch(input, init);
        const real = await realFetch(input, init);
        const bytes = new Uint8Array(await real.arrayBuffer());
        const size = Math.ceil(bytes.length / chunks);
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            while ((w.__chunkGate ?? 0) <= sent && sent < chunks)
              await new Promise((resolve) => setTimeout(resolve, 15));
            if (mode === "steady") await new Promise((r) => setTimeout(r, 12));
            if (sent >= chunks) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.slice(sent * size, (sent + 1) * size));
            sent += 1;
          },
        });
        const headers = new Headers();
        headers.set("content-type", "application/octet-stream");
        if (mode !== "gated-no-length")
          headers.set("content-length", String(bytes.length));
        return new Response(stream, { status: 200, headers });
      };
      // Every value the progress bar exposes to assistive technology.
      new MutationObserver(() => {
        const bar = document.querySelector("[role=progressbar]");
        if (!bar) return;
        const value = bar.getAttribute("aria-valuenow") ?? "indeterminate";
        const seen = w.__progressValues!;
        if (seen[seen.length - 1] !== value) seen.push(value);
      }).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-valuenow"],
      });
    },
    { mode, chunks },
  );
}

export const release = (page: Page, chunks: number) =>
  page.evaluate((n) => {
    (window as Window & { __chunkGate?: number }).__chunkGate = n;
  }, chunks);

export const pill = (page: Page) => page.getByTestId("detector-progress");

export const MODEL_URL = "/mediapipe/models/hand_landmarker.task";
export const LOAD_FAILED = /couldn.t load the hand detector/i;

/**
 * The typed-length flow reaches the detector without needing a sheet of paper
 * in the picture, so a flat grey photo is enough: with a working detector the
 * answer is "no hand", with a broken one it is "couldn't load the detector".
 */
export async function openLengthFlow(page: Page) {
  await page.goto("/scan/easy");
  const noPaper = page.getByRole("button", {
    name: "No paper? Use a ruler instead",
  });
  // One button once the tip is modal (before that the link behind it counts).
  await expect(noPaper).toHaveCount(1);
  await noPaper.click();
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
}

export async function uploadGreyPhoto(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#8a8a8a";
    ctx.fillRect(0, 0, 640, 480);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#easy-scan-upload").setInputFiles({
    name: "grey.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
}
