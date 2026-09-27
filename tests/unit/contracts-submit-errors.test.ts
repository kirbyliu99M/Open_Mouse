import { describe, expect, it } from "vitest";
import { errorResponseSchema } from "../../src/lib/contracts/routes";
import { handleScanSubmission } from "../../src/server/scans/submit";
import type { ScanRepo } from "../../src/server/scans/repo";

/**
 * The contract must describe the error bodies the shipped route really sends.
 * A first draft of `errorResponseSchema` rejected them, and only a reviewer
 * reading both files caught it. This test makes that drift a CI failure.
 */
const unusedRepo = new Proxy({} as ScanRepo, {
  get() {
    throw new Error("repo must not be touched on a rejected request");
  },
});

async function errorBodyFor(
  body: string,
): Promise<{ status: number; json: unknown }> {
  const request = new Request("https://example.test/api/scans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const res = await handleScanSubmission(request, { repo: unusedRepo });
  return { status: res.status, json: await res.json() };
}

describe("POST /api/scans error bodies satisfy errorResponseSchema", () => {
  it("invalid JSON", async () => {
    const { status, json } = await errorBodyFor("{not json");
    expect(status).toBe(400);
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
  });

  it("a body failing validation, which carries field-level issues", async () => {
    const { status, json } = await errorBodyFor(
      JSON.stringify({ hand: "right" }),
    );
    expect(status).toBe(400);
    expect(json).toHaveProperty("issues");
    expect(errorResponseSchema.safeParse(json).success).toBe(true);
  });
});
