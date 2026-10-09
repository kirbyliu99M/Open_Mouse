import { describe, expect, it } from "vitest";
import { parseSessionBody } from "../../src/components/nav/account-nav";

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
