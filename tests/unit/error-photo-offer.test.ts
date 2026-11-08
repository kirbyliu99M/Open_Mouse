import { describe, expect, it } from "vitest";
import {
  errorPhotoOffer,
  type OfferInput,
} from "../../src/client/error-photo/offer";

const hand = Array.from({ length: 21 }, (_, k) => ({ x: k * 10, y: k * 10 }));
const corners = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 60 },
  { x: 0, y: 60 },
];
const overlay = (extra: object = {}) => ({
  imageWidth: 1000,
  imageHeight: 800,
  landmarksPx: hand,
  ...extra,
});
const failure = (
  code: string,
  o: ReturnType<typeof overlay> | null = overlay(),
  card = false,
): OfferInput["result"] => ({
  kind: "gateFailure",
  overlay: o,
  errors: [{ code }],
  ...(card ? { reference: "card" as const } : {}),
});

describe("errorPhotoOffer", () => {
  it("offers nothing with the flag off", () => {
    expect(
      errorPhotoOffer({ enabled: false, result: failure("PAPER_NOT_FOUND") }),
    ).toBeNull();
  });

  it("offers a paper failure that found a hand, with its code", () => {
    expect(
      errorPhotoOffer({ enabled: true, result: failure("PAPER_NOT_FOUND") }),
    ).toMatchObject({
      trigger: "scan-failed",
      mode: "paper",
      failureCode: "PAPER_NOT_FOUND",
    });
  });

  it.each([
    "DECODE_FAILED",
    "DETECTOR_LOAD_FAILED",
    "PROCESSING_FAILED",
    "UNEXPECTED",
  ])("never offers %s", (code) => {
    expect(
      errorPhotoOffer({ enabled: true, result: failure(code) }),
    ).toBeNull();
  });

  it("never offers a failure with no overlay or nothing found on it", () => {
    expect(
      errorPhotoOffer({
        enabled: true,
        result: failure("HAND_NOT_DETECTED", null),
      }),
    ).toBeNull();
    expect(
      errorPhotoOffer({
        enabled: true,
        result: failure("HAND_NOT_DETECTED", overlay({ landmarksPx: null })),
      }),
    ).toBeNull();
    // The sheet alone (no hand) is still something to crop around.
    expect(
      errorPhotoOffer({
        enabled: true,
        result: failure(
          "HAND_NOT_DETECTED",
          overlay({ landmarksPx: null, paperCorners: corners }),
        ),
      }),
    ).not.toBeNull();
  });

  it("offers a card failure only with the card outline", () => {
    expect(
      errorPhotoOffer({
        enabled: true,
        result: failure("CARD_NOT_FOUND", overlay(), true),
      }),
    ).toBeNull();
    expect(
      errorPhotoOffer({
        enabled: true,
        result: failure(
          "MEASUREMENT_OUT_OF_RANGE",
          overlay({ paperCorners: corners }),
          true,
        ),
      }),
    ).toMatchObject({ mode: "card", trigger: "scan-failed" });
  });

  it("offers numbers-wrong on a measured sheet, not while the card question is open", () => {
    const measured = {
      kind: "measured" as const,
      overlay: overlay({ paperCorners: corners }),
      reference: "card" as const,
    };
    expect(
      errorPhotoOffer({
        enabled: true,
        result: { ...measured, cardCheck: "pending" },
      }),
    ).toBeNull();
    expect(errorPhotoOffer({ enabled: true, result: measured })).toMatchObject({
      trigger: "numbers-wrong",
      mode: "card",
    });
    expect(
      errorPhotoOffer({ enabled: true, result: { kind: "processing" } }),
    ).toBeNull();
  });

  it("leaves out a code that does not fit the contract's format", () => {
    const offer = errorPhotoOffer({
      enabled: true,
      result: failure("lower-case"),
    });
    expect(offer).not.toBeNull();
    expect(offer).not.toHaveProperty("failureCode");
  });
});
