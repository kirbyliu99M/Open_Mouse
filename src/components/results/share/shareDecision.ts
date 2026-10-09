/**
 * What to do with the finished PNG: hand it to the system share sheet when the
 * browser can share files, otherwise download it. Pure so the choice is tested
 * without a browser.
 */

export type ShareAction = "share" | "download";

interface ShareCapable {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
}

/**
 * "share" only if the browser has `share` and says it can share this file.
 * A missing `canShare` (older browsers, desktop Firefox) means download.
 */
export function chooseShareAction(
  nav: ShareCapable | undefined,
  file: File,
): ShareAction {
  if (!nav || typeof nav.share !== "function") return "download";
  if (typeof nav.canShare !== "function") return "download";
  try {
    return nav.canShare({ files: [file] }) ? "share" : "download";
  } catch {
    return "download";
  }
}

/** A cancelled share sheet rejects with an AbortError. That is the user's choice, not a failure. */
export function isShareCancelled(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export type ShareOutcome = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Run the chosen action. `download` is injected (it needs the DOM), so the
 * flow, including the AbortError case, is unit-tested.
 */
export async function deliverShareFile(
  file: File,
  nav: ShareCapable | undefined,
  download: (file: File) => void,
): Promise<ShareOutcome> {
  if (chooseShareAction(nav, file) === "share") {
    try {
      await nav!.share!({ files: [file] });
      return "shared";
    } catch (error) {
      if (isShareCancelled(error)) return "cancelled";
      // The sheet failed for another reason (a permission, a size limit):
      // the file is still made, so fall back to the download.
      try {
        download(file);
        return "downloaded";
      } catch {
        return "failed";
      }
    }
  }
  try {
    download(file);
    return "downloaded";
  } catch {
    return "failed";
  }
}
