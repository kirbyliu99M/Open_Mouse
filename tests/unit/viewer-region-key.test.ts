import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { ViewerRegion } from "../../src/components/viewer/ViewerRegion";

/**
 * The region works out its first state once per mount (idle for a mouse with a
 * shell, "unsupported" for one without) and a running viewer holds the model it
 * was started with. So when it is handed another mouse or another scan it must
 * be a new mount: the outer component is keyed by both, and has no hooks, so
 * this calls it as a function and reads the key. There is no DOM in this
 * suite; the real remount is React's own behaviour for a changed key.
 */
const props = (over: Partial<Parameters<typeof ViewerRegion>[0]> = {}) => ({
  scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f",
  mouseSlug: "logitech-g309",
  mouseName: "Logitech G309",
  ...over,
});

describe("ViewerRegion's remount per mouse", () => {
  it("returns one element keyed by the scan and the mouse", () => {
    const element = ViewerRegion(props());
    expect(isValidElement(element)).toBe(true);
    expect(element.key).toBe(
      "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f:logitech-g309",
    );
  });

  it("changes the key when the mouse changes, so a new mouse starts from its own first state", () => {
    expect(ViewerRegion(props()).key).not.toBe(
      ViewerRegion(props({ mouseSlug: "logitech-g502-x" })).key,
    );
    // Including a mouse with no shell, whose first state is already a fallback.
    expect(ViewerRegion(props()).key).not.toBe(
      ViewerRegion(props({ mouseSlug: "pulsar-xlite-v3-mini" })).key,
    );
  });

  it("changes the key when the scan changes", () => {
    expect(ViewerRegion(props()).key).not.toBe(
      ViewerRegion(props({ scanId: "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d" }))
        .key,
    );
  });

  it("keeps the key for the same scan and mouse, so a re-render does not restart a running viewer", () => {
    expect(ViewerRegion(props()).key).toBe(ViewerRegion(props()).key);
    // The name is only a label.
    expect(ViewerRegion(props()).key).toBe(
      ViewerRegion(props({ mouseName: "Another label" })).key,
    );
  });

  it("is mounted by TopPick through ViewerRegion, not around it", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/results/TopPick.tsx"),
      "utf8",
    );
    expect(source).toMatch(/<ViewerRegion\b/);
    expect(source).toMatch(/mouseSlug=\{mouse\.slug\}/);
  });
});
