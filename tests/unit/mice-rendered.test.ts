import { describe, expect, it } from "vitest";
import { firstRendered, isRendered } from "../../src/lib/mice/rendered";

const shown = (name: string) => ({ name, getClientRects: () => [{}] });
const hidden = (name: string) => ({ name, getClientRects: () => [] });

describe("which element is on screen", () => {
  it("is rendered when it has a box, not when it is display: none", () => {
    expect(isRendered(shown("a"))).toBe(true);
    expect(isRendered(hidden("a"))).toBe(false);
  });

  it("picks the first rendered one (the table's row or the card's, whichever the screen shows)", () => {
    expect(firstRendered([hidden("table"), shown("card")])?.name).toBe("card");
    expect(firstRendered([shown("table"), shown("card")])?.name).toBe("table");
    expect(firstRendered([hidden("table"), hidden("card")])).toBeNull();
    expect(firstRendered([])).toBeNull();
  });

  it("needs nothing but getClientRects: an element with no checkVisibility (Safari before 17.4) does not throw", () => {
    const old = shown("old");
    expect("checkVisibility" in old).toBe(false);
    expect(() => firstRendered([old])).not.toThrow();
    expect(firstRendered([old])).toBe(old);
  });
});
