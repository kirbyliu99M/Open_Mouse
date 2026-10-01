import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PHOTO_PRIVACY_COPY,
  PHOTO_PRIVACY_COPY_THIS_DEVICE,
} from "../../src/components/privacy-copy";

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

it("has a device-neutral twin for the desktop entry, and leaves the phone wording alone", () => {
  expect(PHOTO_PRIVACY_COPY_THIS_DEVICE).toBe(
    "Your photo never leaves this device. Only measurements are sent.",
  );
  // The same promise: only the device changes.
  expect(PHOTO_PRIVACY_COPY.replace("your phone", "this device")).toBe(
    PHOTO_PRIVACY_COPY_THIS_DEVICE,
  );
  const entry = readFileSync("src/client/camera/DeviceEntry.tsx", "utf8");
  expect(entry).toMatch(
    /kind === "desktop"\s*\?\s*PHOTO_PRIVACY_COPY_THIS_DEVICE\s*:\s*PHOTO_PRIVACY_COPY/,
  );
});
