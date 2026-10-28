import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAIN_LOGO_HAND,
  MAIN_LOGO_PARTICLES,
  MAIN_LOGO_SIZE,
  mainLogoSvg,
} from "@/lib/brand/palmate-main-logo";
import { PALMATE_MARK_PATH } from "@/lib/brand/palmate-mark";

describe("the Main Palmate Logo", () => {
  it("is the official hand path with the 34 light dots of the Pencil logo", () => {
    expect(MAIN_LOGO_HAND.path).toBe(PALMATE_MARK_PATH);
    expect(MAIN_LOGO_PARTICLES).toHaveLength(34);
  });

  it("keeps the hand and every dot inside its 220 px box", () => {
    expect(MAIN_LOGO_HAND.x + MAIN_LOGO_HAND.w).toBeLessThanOrEqual(
      MAIN_LOGO_SIZE,
    );
    expect(MAIN_LOGO_HAND.y + MAIN_LOGO_HAND.h).toBeLessThanOrEqual(
      MAIN_LOGO_SIZE,
    );
    for (const p of MAIN_LOGO_PARTICLES) {
      expect(MAIN_LOGO_HAND.x + p.x + p.d).toBeLessThanOrEqual(MAIN_LOGO_SIZE);
      expect(MAIN_LOGO_HAND.y + p.y + p.d).toBeLessThanOrEqual(MAIN_LOGO_SIZE);
    }
  });

  it("has no ring (Kirby 2026-10-26): only the glow, the hand and dots", () => {
    const svg = mainLogoSvg();
    expect(svg.match(/<circle/g)).toHaveLength(35); // 34 dots + the core
    expect(svg).not.toMatch(/<ellipse|stroke="#7FA8FF26"|stroke="#CFE0FF1A"/);
  });

  it("the public SVG file is what the data writes (`npm run brand:main-logo`)", () => {
    const file = readFileSync(
      path.resolve(
        __dirname,
        "../../public/images/brand/palmate-main-logo.svg",
      ),
      "utf-8",
    );
    expect(file).toBe(mainLogoSvg());
  });
});
