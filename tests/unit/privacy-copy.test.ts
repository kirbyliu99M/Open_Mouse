import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  PHOTO_PRIVACY_COPY,
  PHOTO_PRIVACY_COPY_THIS_DEVICE,
} from "../../src/components/privacy-copy";

it("keeps the shared privacy promise on How it works, the scan screens and the camera", () => {
  // The home page used to carry it too. It lost its copy when Home v3 removed
  // the taglines (Kirby, 2026-10-03), so these are the surfaces that keep the
  // promise: if one of them stops using the shared copy, the promise must not
  // silently disappear from all of them.
  expect(PHOTO_PRIVACY_COPY).toBe(
    "Your photo never leaves your phone. Only measurements are sent.",
  );
  for (const path of [
    "src/app/how-it-works/page.tsx",
    "src/app/scan/ScanClient.tsx",
    "src/client/camera/CameraCapture.tsx",
    "src/client/camera/EasyScanCamera.tsx",
  ]) {
    expect(readFileSync(path, "utf8"), path).toContain("PHOTO_PRIVACY_COPY");
  }
});

it("does not put the photo-privacy sentence on the home page", () => {
  const home = readFileSync("src/app/page.tsx", "utf8");
  expect(home).not.toContain("PHOTO_PRIVACY_COPY");
  expect(home).not.toContain("never leaves");
  expect(home).not.toContain("Private by design");
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
