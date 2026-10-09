import { describe, expect, it, vi } from "vitest";
import {
  bandLabelFor,
  buildShareCardInput,
  shareFileName,
  topPick,
  topPickPhotoPath,
} from "../../src/components/results/share/input";
import {
  chooseShareAction,
  deliverShareFile,
  isShareCancelled,
} from "../../src/components/results/share/shareDecision";
import {
  fitResponseSchema,
  type FitResponse,
} from "../../src/lib/contracts/fit";
import highConfidence from "../../src/components/results/fixtures/high-confidence.json";

const file = new File([new Uint8Array([1, 2, 3])], "palmate-x.png", {
  type: "image/png",
});

describe("chooseShareAction", () => {
  it("shares when the browser can share this file", () => {
    const nav = { share: vi.fn(), canShare: vi.fn(() => true) };
    expect(chooseShareAction(nav, file)).toBe("share");
    expect(nav.canShare).toHaveBeenCalledWith({ files: [file] });
  });

  it("downloads when canShare says no", () => {
    expect(
      chooseShareAction({ share: vi.fn(), canShare: () => false }, file),
    ).toBe("download");
  });

  it("downloads when canShare is missing, share is missing, or there is no navigator", () => {
    expect(chooseShareAction({ share: vi.fn() }, file)).toBe("download");
    expect(chooseShareAction({ canShare: () => true }, file)).toBe("download");
    expect(chooseShareAction({}, file)).toBe("download");
    expect(chooseShareAction(undefined, file)).toBe("download");
  });

  it("downloads when canShare throws", () => {
    const nav = {
      share: vi.fn(),
      canShare: () => {
        throw new TypeError("nope");
      },
    };
    expect(chooseShareAction(nav, file)).toBe("download");
  });
});

describe("isShareCancelled", () => {
  it("is true only for an AbortError", () => {
    expect(isShareCancelled(new DOMException("x", "AbortError"))).toBe(true);
    expect(isShareCancelled({ name: "AbortError" })).toBe(true);
    expect(isShareCancelled(new DOMException("x", "NotAllowedError"))).toBe(
      false,
    );
    expect(isShareCancelled(new Error("x"))).toBe(false);
    expect(isShareCancelled(null)).toBe(false);
    expect(isShareCancelled("AbortError")).toBe(false);
  });
});

describe("deliverShareFile", () => {
  it("shares the file and does not also download it", async () => {
    const share = vi.fn(async () => {});
    const download = vi.fn();
    const out = await deliverShareFile(
      file,
      { share, canShare: () => true },
      download,
    );
    expect(out).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(download).not.toHaveBeenCalled();
  });

  it("treats a cancelled share (AbortError) as neither an error nor a download", async () => {
    const download = vi.fn();
    const out = await deliverShareFile(
      file,
      {
        canShare: () => true,
        share: async () => {
          throw new DOMException("cancelled", "AbortError");
        },
      },
      download,
    );
    expect(out).toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });

  it("falls back to the download when the share sheet fails for another reason", async () => {
    const download = vi.fn();
    const out = await deliverShareFile(
      file,
      {
        canShare: () => true,
        share: async () => {
          throw new DOMException("no gesture", "NotAllowedError");
        },
      },
      download,
    );
    expect(out).toBe("downloaded");
    expect(download).toHaveBeenCalledWith(file);
  });

  it("downloads when the browser cannot share files", async () => {
    const download = vi.fn();
    expect(await deliverShareFile(file, undefined, download)).toBe(
      "downloaded",
    );
    expect(download).toHaveBeenCalledWith(file);
  });

  it("reports a failure when even the download throws", async () => {
    const out = await deliverShareFile(file, undefined, () => {
      throw new Error("blocked");
    });
    expect(out).toBe("failed");
  });
});

describe("the share card's input from a fit response", () => {
  const fit: FitResponse = fitResponseSchema.parse(highConfidence);
  const withHandType: FitResponse = {
    ...fit,
    handType: { size: "medium", grip: "claw", width: "wide" },
  };

  it("takes the best-ranked entry, whatever the array order", () => {
    const reversed: FitResponse = {
      ...fit,
      results: [...fit.results].reverse(),
    };
    expect(topPick(reversed)?.rank).toBe(1);
    expect(topPick({ ...fit, results: [] })).toBeNull();
  });

  it("returns null for an empty result list", () => {
    expect(buildShareCardInput({ ...fit, results: [] }, "en", null)).toBeNull();
  });

  it("copies the top pick, its total and its band, and adds nothing else", () => {
    const top = fit.results[0]!;
    const input = buildShareCardInput(withHandType, "zh-TW", null)!;
    expect(input).toEqual({
      lang: "zh-TW",
      handType: { size: "medium", grip: "claw", width: "wide" },
      brand: top.mouse.brand,
      model: top.mouse.model,
      total: top.total,
      bandLabel: "非常適合你",
      photoSrc: null,
    });
  });

  it("has no handType when the engine sent none (fit-v0), and never makes one up", () => {
    expect(fit.handType).toBeUndefined();
    const input = buildShareCardInput(fit, "en", null)!;
    expect("handType" in input).toBe(false);
    expect(input.bandLabel).toBe("A very good fit");
  });

  it("carries a per-person value nowhere", () => {
    const input = buildShareCardInput(withHandType, "en", null)!;
    const json = JSON.stringify(input);
    expect(json).not.toContain(fit.scanId);
    expect(json).not.toMatch(/mm|Mm/);
  });

  it("keeps a photo path only if it is on this site", () => {
    expect(buildShareCardInput(fit, "en", "/images/a.png")!.photoSrc).toBe(
      "/images/a.png",
    );
    expect(
      buildShareCardInput(fit, "en", "https://x.example/a.png")!.photoSrc,
    ).toBeNull();
    const first = fit.results[0]!;
    const withPhoto: FitResponse = {
      ...fit,
      results: [
        { ...first, mouse: { ...first.mouse, imageUrl: "/images/a.png" } },
      ],
    };
    expect(topPickPhotoPath(withPhoto)).toBe("/images/a.png");
    expect(topPickPhotoPath(fit)).toBeNull();
  });

  it("names a band for a total, and none for a total it cannot grade", () => {
    expect(bandLabelFor(90, "en")).toBe("A very good fit");
    expect(bandLabelFor(40, "zh-TW")).toBe("不太適合");
    expect(bandLabelFor(101, "en")).toBeNull();
    expect(bandLabelFor(70.5, "en")).toBeNull();
  });

  it("builds a safe file name", () => {
    expect(shareFileName("logitech-g-pro-x-superlight-2")).toBe(
      "palmate-logitech-g-pro-x-superlight-2.png",
    );
    expect(shareFileName("../../Evil Name?.png")).toBe(
      "palmate-evil-name-png.png",
    );
    expect(shareFileName("")).toBe("palmate-mouse.png");
  });
});
