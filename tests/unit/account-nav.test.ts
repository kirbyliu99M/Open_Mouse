import { describe, expect, it } from "vitest";
import {
  initialOf,
  parseSessionBody,
} from "../../src/components/nav/account-nav";

describe("parseSessionBody", () => {
  it("reads a signed-in body", () => {
    expect(
      parseSessionBody({
        expires: "x",
        user: { id: "u1", name: "Ada", image: "https://x/y.png" },
      }),
    ).toEqual({ name: "Ada", image: "https://x/y.png" });
  });
  it("nulls missing or blank profile fields", () => {
    expect(
      parseSessionBody({ user: { id: "u1", name: " ", image: 3 } }),
    ).toEqual({ name: null, image: null });
  });
  it.each([
    null,
    undefined,
    "x",
    4,
    {},
    { user: null },
    { user: {} },
    { user: { id: "" } },
  ])("is signed out for %j", (body) => {
    expect(parseSessionBody(body)).toBeNull();
  });
});

describe("initialOf", () => {
  it("upper-cases the first letter", () => {
    expect(initialOf("  ada lovelace")).toBe("A");
    expect(initialOf("\u00e9lan")).toBe("\u00c9");
    expect(initialOf("\u6797")).toBe("\u6797");
  });
  it("is null without a name", () => {
    expect(initialOf(null)).toBeNull();
    expect(initialOf("   ")).toBeNull();
  });
});
