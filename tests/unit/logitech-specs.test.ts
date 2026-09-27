import { describe, expect, it } from "vitest";
import {
  conventionFor,
  dimensionWarnings,
  parseLogitechDimensions,
} from "../../src/server/catalogue/logitech-specs";

const facet = (name: string, value = "") =>
  `{facet:"${name}",value:"${value}",numeric:"",unit:""}`;
const page = (...facets: string[]) =>
  `<script>x={techSpecs:{},productDimensions:{facet:"Dimensions",value:"",specs:{spec:[${facets.join(",")}]}}}</script>`;

const G_URL =
  "https://www.logitechg.com/en-us/shop/p/pro-x2-superlight-wireless-mouse";
const CONSUMER_URL = "https://www.logitech.com/en-us/shop/p/mx-master-3s";

describe("parseLogitechDimensions", () => {
  it("reads logitechg.com labels literally", () => {
    const html = page(
      facet("Height", "1.57 in (40 mm)"),
      facet("Width", "2.5 in (63.5 mm)"),
      facet("Length", "4.92 in (125 mm)"),
      facet("Weight", "2.12 oz (60 g)"),
    );
    expect(parseLogitechDimensions(html, G_URL)).toEqual({
      lengthMm: 125,
      widthMm: 63.5,
      heightMm: 40,
      weightG: 60,
    });
  });

  it("maps logitech.com Height→length and Depth→height", () => {
    const html = page(
      facet("MX Master 3S Mouse"),
      facet("Height", "4.92 in (124.9 mm)"),
      facet("Width", "3.32 in (84.3 mm)"),
      facet("Depth", "2.01 in (51 mm)"),
      facet("Weight", "4.97 oz (141 g)"),
    );
    expect(parseLogitechDimensions(html, CONSUMER_URL)).toEqual({
      lengthMm: 124.9,
      widthMm: 84.3,
      heightMm: 51,
      weightG: 141,
    });
  });

  it("stops at the second group so receiver dimensions never leak in", () => {
    const html = page(
      facet("MX Master 3S Mouse"),
      facet("Height", "(124.9 mm)"),
      facet("Logi Bolt USB Receiver"),
      facet("Width", "(14.4 mm)"),
      facet("Depth", "(6.11 mm)"),
    );
    const d = parseLogitechDimensions(html, CONSUMER_URL);
    expect(d.lengthMm).toBe(124.9);
    expect(d.widthMm).toBeNull();
    expect(d.heightMm).toBeNull();
  });

  it("never trusts a bare number outside the labelled block", () => {
    expect(
      parseLogitechDimensions("<p>Only 60 g and (125 mm) long!</p>", G_URL),
    ).toEqual({
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      weightG: null,
    });
  });

  it("rejects hosts with no known convention", () => {
    expect(() => conventionFor("https://example.com/mouse")).toThrow(
      "No axis convention",
    );
  });
});

describe("AXIS_OVERRIDES", () => {
  const MOBI_FOLD_URL = "https://www.logitech.com/en-us/shop/p/mobi-fold-mouse";
  const MX_ERGO_S_URL =
    "https://www.logitech.com/en-us/shop/p/mx-ergo-s-wireless-trackball-mouse";

  it("axis override: Mobi Fold's own page labels Height/Depth the opposite of every other logitech.com page — its override maps Height→height and Depth→length", () => {
    const html = page(
      facet("Mobi Fold"),
      facet("Height", "1.3 in (33 mm)"),
      facet("Width", "2.24 in (57 mm)"),
      facet("Depth", "4.8 in (122 mm)"),
      facet("Weight", "2.79 oz (79 g)"),
    );
    expect(parseLogitechDimensions(html, MOBI_FOLD_URL)).toEqual({
      lengthMm: 122,
      widthMm: 57,
      heightMm: 33,
      weightG: 79,
    });
  });

  it("without an override, the same Height/Depth facets keep the default logitech.com mapping (Height→length, Depth→height)", () => {
    // Same facet names and header shape as the Mobi Fold fixture above, but a
    // URL not present in AXIS_OVERRIDES — proves the override is keyed to
    // that one page, not a global change to how Height/Depth are read.
    const html = page(
      facet("Some Other Mouse"),
      facet("Height", "1.3 in (33 mm)"),
      facet("Width", "2.24 in (57 mm)"),
      facet("Depth", "4.8 in (122 mm)"),
      facet("Weight", "2.79 oz (79 g)"),
    );
    expect(parseLogitechDimensions(html, CONSUMER_URL)).toEqual({
      lengthMm: 33,
      widthMm: 57,
      heightMm: 122,
      weightG: 79,
    });
  });

  it("weight-group override: MX Ergo S's weight sits in a later group ('without metal plate'), past where the default parser would stop", () => {
    const html = page(
      facet("Mouse"),
      facet("Height", "5.22 in (132.5 mm)"),
      facet("Width", "3.93 in (99.8 mm)"),
      facet("Depth", "2.02 in (51.4 mm)"),
      facet("Mouse (without metal plate/without receiver)"),
      facet("Weight", "5.78 oz (164 g)"),
      facet("Mouse (with metal plate/without receiver)"),
      facet("Weight", "9.14 oz (259 g)"),
    );
    expect(parseLogitechDimensions(html, MX_ERGO_S_URL)).toEqual({
      lengthMm: 132.5,
      widthMm: 99.8,
      heightMm: 51.4,
      weightG: 164, // not 259 — the "with metal plate" group's weight
    });
  });

  it("without a weight-group override, a page still stops at the second group (no regression for every other page)", () => {
    const html = page(
      facet("Mouse"),
      facet("Height", "5.22 in (132.5 mm)"),
      facet("Width", "3.93 in (99.8 mm)"),
      facet("Depth", "2.02 in (51.4 mm)"),
      facet("Mouse (without metal plate/without receiver)"),
      facet("Weight", "5.78 oz (164 g)"),
    );
    const d = parseLogitechDimensions(html, CONSUMER_URL);
    expect(d.lengthMm).toBe(132.5);
    expect(d.weightG).toBeNull(); // stopped before the second group's weight
  });
});

describe("dimensionWarnings", () => {
  it("accepts a normal mouse and a vertical one", () => {
    expect(
      dimensionWarnings({
        lengthMm: 125,
        widthMm: 63.5,
        heightMm: 40,
        weightG: 60,
      }),
    ).toEqual([]);
    expect(
      dimensionWarnings({
        lengthMm: 108,
        widthMm: 70,
        heightMm: 71,
        weightG: 125,
      }),
    ).toEqual([]);
  });

  it("flags a swapped axis — the failure the per-site convention exists to prevent", () => {
    expect(
      dimensionWarnings({
        lengthMm: 51,
        widthMm: 84.3,
        heightMm: 124.9,
        weightG: 141,
      }).join(),
    ).toMatch(/axis convention/);
  });

  it("lists missing fields", () => {
    expect(
      dimensionWarnings({
        lengthMm: 131.4,
        widthMm: 79.2,
        heightMm: 41.1,
        weightG: null,
      }),
    ).toEqual(["missing weightG"]);
  });
});
