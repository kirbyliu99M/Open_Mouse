import type { ShellSpec } from "./shell-parameters";

// Dimensions: first-party specs. Descriptors: provisional authoring judgments
// from the linked official renders, not M1 classifier results or fixture labels.
export const models: Array<
  ShellSpec & {
    sourceUrl: string;
    referenceUrl: string;
    color: [number, number, number];
    seam: "straight" | "chevron";
  }
> = [
  {
    id: "logitech-g-pro-x-superlight-2",
    model: "Logitech G Pro X Superlight 2",
    lengthMm: 125,
    widthMm: 63.5,
    heightMm: 40,
    shape: "symmetrical",
    handCompatibility: "right",
    humpPlacement: "center",
    frontFlare: "outward_slight",
    sideCurvature: "inward",
    thumbRest: false,
    ringFingerRest: false,
    sourceUrl:
      "https://www.logitechg.com/en-us/shop/p/pro-x2-superlight-wireless-mouse",
    referenceUrl:
      "https://resource.logitechg.com/content/dam/gaming/en/products/pro-x-superlight-2/new-gallery-assets-2025/pro-x-superlight-2-mice-profile-right-angle-white-gallery-5.png",
    color: [0.7, 0.76, 0.78],
    seam: "straight",
  },
  {
    id: "logitech-g305-lightspeed",
    model: "Logitech G305 Lightspeed",
    lengthMm: 116.6,
    widthMm: 62.15,
    heightMm: 38.2,
    shape: "symmetrical",
    handCompatibility: "right",
    humpPlacement: "back_minimal",
    frontFlare: "inward_slight",
    sideCurvature: "inward",
    thumbRest: false,
    ringFingerRest: false,
    sourceUrl:
      "https://support.logi.com/hc/en-nz/articles/360023303254-G305-LIGHTSPEED-Wireless-Gaming-Mouse-Technical-Specifications",
    referenceUrl:
      "https://resource.logitechg.com/content/dam/gaming/en/products/g305/2025-update/g305-lightspeed-mouse-profile-left-angle-white-gallery-4.png",
    color: [0.7, 0.56, 0.37],
    seam: "chevron",
  },
  {
    id: "logitech-g703-lightspeed",
    model: "Logitech G703 Lightspeed",
    lengthMm: 124,
    widthMm: 68,
    heightMm: 43,
    shape: "ergonomic",
    handCompatibility: "right",
    humpPlacement: "back_minimal",
    frontFlare: "outward_slight",
    sideCurvature: "inward",
    thumbRest: false,
    ringFingerRest: false,
    sourceUrl:
      "https://support.logi.com/hc/en-us/articles/360023462513-G703-Wired-Wireless-Gaming-Mouse-Technical-Specifications",
    referenceUrl:
      "https://resource.logitechg.com/content/dam/gaming/en/products/g703-hero/2025-update/g703-mouse-profile-left-angle-gallery-2.png",
    color: [0.07, 0.27, 0.29],
    seam: "chevron",
  },
];
