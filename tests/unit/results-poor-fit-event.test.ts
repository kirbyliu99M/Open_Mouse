/**
 * M6 (v3.1 consumers): `results_page_viewed.poorFit` is not sent while the
 * hand is outside the catalogue's length range (`total` is a ranking value
 * there, not a fit). In range it is the same boolean as before.
 */
import { describe, expect, it } from "vitest";
import {
  POOR_FIT_THRESHOLD,
  poorFitField,
} from "../../src/components/results/fitNotice";
import { analyticsEventSchemas } from "../../src/lib/contracts/analytics";
import { outOfRange, inRange } from "./fit-out-of-range-fixture";

const READY = {
  state: "ready",
  page: "main",
  rank: 1,
  filtered: false,
  mouse: "logitech-g-pro-x-superlight-2",
  overallRank: 1,
} as const;

describe("poorFitField", () => {
  it("in range: the boolean against the poor-fit threshold, either way", () => {
    expect(poorFitField(inRange(), POOR_FIT_THRESHOLD - 1)).toEqual({
      poorFit: true,
    });
    expect(poorFitField(inRange(), POOR_FIT_THRESHOLD)).toEqual({
      poorFit: false,
    });
  });

  it("a response with no coverage block (v0, v1) behaves as before", () => {
    expect(poorFitField({}, 10)).toEqual({ poorFit: true });
    expect(poorFitField({}, 90)).toEqual({ poorFit: false });
  });

  it("out of range: no poorFit key at all, whatever the total", () => {
    for (const total of [0, POOR_FIT_THRESHOLD - 1, 99]) {
      const field = poorFitField(outOfRange(), total);
      expect(field).toEqual({});
      expect("poorFit" in field).toBe(false);
    }
  });

  it("the event without poorFit still passes its schema, and an unknown key does not", () => {
    const viewed = analyticsEventSchemas.results_page_viewed;
    const sent = { ...READY, ...poorFitField(outOfRange(), 12) };
    expect(sent).not.toHaveProperty("poorFit");
    expect(viewed.safeParse(sent).success).toBe(true);
    expect(
      viewed.safeParse({ ...READY, ...poorFitField(inRange(), 12) }).success,
    ).toBe(true);
    expect(viewed.safeParse({ ...sent, total: 12 }).success).toBe(false);
  });
});
