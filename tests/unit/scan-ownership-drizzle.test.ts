import { describe, expect, it, vi } from "vitest";

// `server-only` (imported by src/server/scans/drizzle-repo.ts) throws when
// loaded outside a React Server Component; stub it so the real repo module
// can be imported and exercised here instead of never being unit-tested.
vi.mock("server-only", () => ({}));

import { createDrizzleScanRepo } from "../../src/server/scans/drizzle-repo";
import { fakeDrizzleChain } from "./fixtures/fake-drizzle";

type FakeDb = Parameters<typeof createDrizzleScanRepo>[0];

const NOW = new Date("2026-09-23T12:00:00Z");

const dbRow = {
  hand: "left" as const,
  gripStyleStated: "palm" as const,
  handLengthMm: 180,
  palmLengthMm: 100,
  palmWidthMm: 85,
  thumbLengthMm: null,
  indexLengthMm: null,
  middleLengthMm: null,
  ringLengthMm: null,
  pinkyLengthMm: null,
  palmThicknessMm: null,
  knuckleHeightMm: null,
  gripApertureMm: null,
  thumbAngleDeg: null,
};

describe("createDrizzleScanRepo().findOwnedScan", () => {
  it("never queries the database when neither a user nor a cookie session is presented", async () => {
    const chain = fakeDrizzleChain([dbRow]);
    const repo = createDrizzleScanRepo(chain as unknown as FakeDb);

    const result = await repo.findOwnedScan("scan-1", {
      userId: null,
      cookieSessionId: null,
      now: NOW,
    });

    expect(result).toBeNull();
    expect(chain.select).not.toHaveBeenCalled();
  });

  it("maps a matching row to an OwnedScan, converting null optional measurements to undefined", async () => {
    const chain = fakeDrizzleChain([dbRow]);
    const repo = createDrizzleScanRepo(chain as unknown as FakeDb);

    const result = await repo.findOwnedScan("scan-1", {
      userId: "user-1",
      cookieSessionId: null,
      now: NOW,
    });

    expect(result).toEqual({
      hand: "left",
      gripStyleStated: "palm",
      measurements: {
        handLengthMm: 180,
        palmLengthMm: 100,
        palmWidthMm: 85,
        thumbLengthMm: undefined,
        indexLengthMm: undefined,
        middleLengthMm: undefined,
        ringLengthMm: undefined,
        pinkyLengthMm: undefined,
        palmThicknessMm: undefined,
        knuckleHeightMm: undefined,
        gripApertureMm: undefined,
        thumbAngleDeg: undefined,
      },
    });
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it("returns null when the database finds no matching, owned row (unknown scan / wrong owner / expired)", async () => {
    const chain = fakeDrizzleChain([]);
    const repo = createDrizzleScanRepo(chain as unknown as FakeDb);

    const result = await repo.findOwnedScan("scan-1", {
      userId: "user-1",
      cookieSessionId: "cookie-session",
      now: NOW,
    });

    expect(result).toBeNull();
  });

  it("still queries when only a cookie session id is presented (anonymous caller)", async () => {
    const chain = fakeDrizzleChain([dbRow]);
    const repo = createDrizzleScanRepo(chain as unknown as FakeDb);

    const result = await repo.findOwnedScan("scan-1", {
      userId: null,
      cookieSessionId: "cookie-session",
      now: NOW,
    });

    expect(result).not.toBeNull();
    expect(chain.select).toHaveBeenCalledTimes(1);
  });
});
