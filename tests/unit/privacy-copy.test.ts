import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PHOTO_PRIVACY_COPY } from "../../src/components/privacy-copy";

it("uses the shared privacy copy on home, scan, and camera screens", () => {
  expect(PHOTO_PRIVACY_COPY).toBe(
    "Your photo never leaves your phone. Only measurements are sent.",
  );
  for (const path of [
    "src/app/page.tsx",
    "src/app/scan/ScanClient.tsx",
    "src/client/camera/CameraCapture.tsx",
    "src/client/camera/EasyScanCamera.tsx",
  ]) {
    expect(readFileSync(path, "utf8"), path).toContain("PHOTO_PRIVACY_COPY");
  }
});
