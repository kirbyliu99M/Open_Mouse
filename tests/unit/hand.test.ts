import { describe, expect, it } from "vitest";
import { resolvePipelineHand } from "../../src/client/photo/hand";
import { checkHandedness } from "../../src/client/photo/gates";

type Hand = "left" | "right";

describe("resolvePipelineHand", () => {
  it.each([
    ["right", "left"],
    ["left", "right"],
  ] as const)(
    "auto (default %s, photo shows %s): submits the detected hand and compares nothing",
    (selected, detected) => {
      expect(
        resolvePipelineHand({ selected, detected, explicit: false }),
      ).toEqual({ stated: undefined, submitted: detected });
    },
  );

  it("auto with no handedness label falls back to the default hand", () => {
    expect(
      resolvePipelineHand({
        selected: "right",
        detected: null,
        explicit: false,
      }),
    ).toEqual({ stated: undefined, submitted: "right" });
  });

  it.each([
    ["right", "left"],
    ["left", "right"],
    ["right", "right"],
    ["right", null],
  ] as const)(
    "a chosen %s hand is always submitted and compared (photo shows %s)",
    (selected, detected) => {
      expect(
        resolvePipelineHand({ selected, detected, explicit: true }),
      ).toEqual({ stated: selected, submitted: selected });
    },
  );

  const hands: readonly Hand[] = ["left", "right"];
  it.each(
    hands.flatMap((selected) =>
      hands.map((detected) => [selected, detected] as const),
    ),
  )(
    "raises HANDEDNESS_MISMATCH only for a chosen hand that disagrees (%s vs photo %s)",
    (selected, detected) => {
      const chosen = resolvePipelineHand({
        selected,
        detected,
        explicit: true,
      });
      const auto = resolvePipelineHand({ selected, detected, explicit: false });
      expect(checkHandedness(detected, chosen.stated)?.code ?? null).toBe(
        selected === detected ? null : "HANDEDNESS_MISMATCH",
      );
      expect(checkHandedness(detected, auto.stated)).toBeNull();
    },
  );
});
