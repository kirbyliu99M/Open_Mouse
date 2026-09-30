import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlag } from "../../src/lib/flags";
import {
  EDIT_HAND_LENGTH_LABEL,
  failureOffersLengthEdit,
  NO_PAPER_ENTRY_LABEL,
  noPaperEntryLabel,
} from "../../src/client/camera/noPaperEntry";

const ENV_NAME = "NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY";

async function loadFlagWith(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv(ENV_NAME, undefined);
  else vi.stubEnv(ENV_NAME, value);
  return import("../../src/lib/flags");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("parseFlag", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["off", false],
    ["yes", false],
    ["1", true],
    ["true", true],
    ["TRUE", true],
    [" 1 ", true],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseFlag(raw)).toBe(expected);
  });
});

describe("typed hand length entry flag", () => {
  it("is OFF when the environment variable is unset (the production default)", async () => {
    const flags = await loadFlagWith(undefined);
    expect(flags.TYPED_HAND_LENGTH_ENTRY_ENABLED).toBe(false);
  });

  it("stays OFF for a value that does not mean on", async () => {
    const flags = await loadFlagWith("0");
    expect(flags.TYPED_HAND_LENGTH_ENTRY_ENABLED).toBe(false);
  });

  it("turns ON with NEXT_PUBLIC_TYPED_HAND_LENGTH_ENTRY=1", async () => {
    const flags = await loadFlagWith("1");
    expect(flags.TYPED_HAND_LENGTH_ENTRY_ENABLED).toBe(true);
  });
});

describe("noPaperEntryLabel", () => {
  it("hides the entry when the flag is off, whether or not a length was typed", () => {
    expect(noPaperEntryLabel(false, false)).toBeNull();
    expect(noPaperEntryLabel(true, false)).toBeNull();
  });

  it("shows the entry when the flag is on", () => {
    expect(noPaperEntryLabel(false, true)).toBe(NO_PAPER_ENTRY_LABEL);
    expect(noPaperEntryLabel(true, true)).toBe(EDIT_HAND_LENGTH_LABEL);
  });

  it("defaults to the build-time flag, which is off with the variable unset", async () => {
    vi.resetModules();
    vi.stubEnv(ENV_NAME, undefined);
    const entry = await import("../../src/client/camera/noPaperEntry");
    expect(entry.noPaperEntryLabel(false)).toBeNull();
    expect(entry.noPaperEntryLabel(true)).toBeNull();
  });

  it("follows the build-time flag when it is on", async () => {
    vi.resetModules();
    vi.stubEnv(ENV_NAME, "1");
    const entry = await import("../../src/client/camera/noPaperEntry");
    expect(entry.noPaperEntryLabel(false)).toBe(entry.NO_PAPER_ENTRY_LABEL);
  });
});

describe("every no-paper entry in EasyScanCamera goes through the flag", () => {
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");

  it("has no hard-coded entry label that bypasses noPaperEntryLabel", () => {
    expect(source).not.toContain(NO_PAPER_ENTRY_LABEL);
    expect(source).not.toContain(EDIT_HAND_LENGTH_LABEL);
    expect(source).toContain("noPaperEntryLabel(");
  });

  it("renders every startLengthStep button only inside a noPaperLabel guard", () => {
    const openers = [
      ...source.matchAll(
        /onClick=\{(?:startLengthStep|editLengthFromFailure)\}/g,
      ),
    ];
    expect(openers.length).toBeGreaterThan(0);
    for (const opener of openers) {
      // The nearest guard above this onClick must still be open here: a line
      // that is just `)}` between them would have closed it.
      const before = source.slice(0, opener.index);
      const guardAt = before.lastIndexOf("{noPaperLabel &&");
      expect(guardAt, `guard above offset ${opener.index}`).toBeGreaterThan(-1);
      expect(
        before.slice(guardAt),
        `guard closed before offset ${opener.index}`,
      ).not.toMatch(/\n\s*\)\}\s*\n/);
    }
  });
});

describe("device routing does not depend on the flag", () => {
  it.each([
    "src/client/camera/deviceFit.ts",
    "src/client/camera/DeviceEntry.tsx",
  ])("%s does not import the flags module", (path) => {
    expect(readFileSync(path, "utf8")).not.toMatch(/flags|noPaperEntry/);
  });
});

describe("failureOffersLengthEdit", () => {
  it("offers the edit only for a palm that does not fit the typed length", () => {
    expect(failureOffersLengthEdit(true, "MEASUREMENT_OUT_OF_RANGE")).toBe(
      true,
    );
    for (const code of [
      "HAND_NOT_DETECTED",
      "FINGER_NOT_STRAIGHT",
      "HAND_TILTED",
      "HANDEDNESS_MISMATCH",
      "LOW_LANDMARK_CONFIDENCE",
      undefined,
    ]) {
      expect(failureOffersLengthEdit(true, code), String(code)).toBe(false);
    }
  });

  it("never offers it outside no-paper mode", () => {
    expect(failureOffersLengthEdit(false, "MEASUREMENT_OUT_OF_RANGE")).toBe(
      false,
    );
  });

  it("is what the failure sheet checks", () => {
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(source).toMatch(
      /failureOffersLengthEdit\(\s*noPaperMode,\s*result\.errors\[0\]\?\.code,?\s*\)/,
    );
  });
});
