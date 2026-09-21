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
