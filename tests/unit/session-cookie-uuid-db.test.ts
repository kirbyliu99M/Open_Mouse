/**
 * `parseSessionId` (src/server/scans/cookies.ts) against a real Postgres.
 *
 * Its whole job is to keep a value out of a `uuid` query that Postgres would
 * reject (22P02). So the property that matters is one-directional: every
 * value it accepts, Postgres's `::uuid` accepts too. The reverse need not
 * hold (Postgres also takes braces, no hyphens, ...; refusing those just
 * means "no cookie"), and the tables below pin both what is refused and what
 * Postgres would have said about it.
 */
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSessionId } from "../../src/server/scans/cookies";

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

async function postgresAcceptsAsUuid(value: string): Promise<boolean> {
  try {
    await pg.query("SELECT $1::uuid AS u", [value]);
    return true;
  } catch {
    return false;
  }
}

describe("parseSessionId accepts only what Postgres accepts as a uuid", () => {
  const accepted = [
    ["lowercase", "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f"],
    ["uppercase", "3F1C2D4E-5A6B-4C7D-8E9F-0A1B2C3D4E5F"],
    ["mixed case", "3f1c2D4E-5a6B-4c7D-8e9F-0A1b2C3d4E5f"],
    ["the nil uuid", "00000000-0000-0000-0000-000000000000"],
    ["all f", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
    ["a random v4", randomUUID()],
  ] as const;

  it.each(accepted)("%s: accepted by both", async (_label, value) => {
    expect(parseSessionId(value)).toBe(value);
    expect(await postgresAcceptsAsUuid(value)).toBe(true);
  });

  // [label, value, does Postgres accept it?]
  const refused: [string, string, boolean][] = [
    // Right shape, wrong characters (the character class must be hex).
    ["36 chars, all 'z'", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", false],
    [
      "36 chars, one 'g' at the end",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaag",
      false,
    ],
    [
      "36 chars, one 'G' at the start",
      "Gaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "36 chars, one 'z' in the middle",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaazaaaaa",
      false,
    ],
    [
      "full-width digits",
      "００００００００-0000-0000-0000-000000000000",
      false,
    ],
    // Right total length (36), wrong group lengths.
    ["groups 7-5-4-4-12", "aaaaaaa-aaaaa-aaaa-aaaa-aaaaaaaaaaaa", false],
    ["groups 8-5-3-4-12", "aaaaaaaa-aaaaa-aaa-aaaa-aaaaaaaaaaaa", false],
    ["groups 9-4-4-4-11", "aaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa", false],
    ["groups 7-4-4-4-13", "aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaaa", false],
    // One group short, so 35 characters.
    [
      "first group short (7-4-4-4-12)",
      "aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "second group short (8-3-4-4-12)",
      "aaaaaaaa-aaa-aaaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "third group short (8-4-3-4-12)",
      "aaaaaaaa-aaaa-aaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "fourth group short (8-4-4-3-12)",
      "aaaaaaaa-aaaa-aaaa-aaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "last group short (8-4-4-4-11)",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa",
      false,
    ],
    // One group long, so 37 characters.
    [
      "first group long (9-4-4-4-12)",
      "aaaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "second group long (8-5-4-4-12)",
      "aaaaaaaa-aaaaa-aaaa-aaaa-aaaaaaaaaaaa",
      false,
    ],
    [
      "last group long (8-4-4-4-13)",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaaa",
      false,
    ],
    // Surrounding characters.
    ["trailing newline", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n", false],
    ["leading space", " aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", false],
    ["trailing space", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa ", false],
    ["urn: prefix", "urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", false],
    // Forms Postgres is more lenient about: refused here, so "no cookie".
    ["32 hex digits, no hyphens", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true],
    ["in braces", "{aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa}", true],
    [
      "hyphen after every 4 digits",
      "aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa",
      true,
    ],
  ];

  it.each(refused)("refused: %s", async (_label, value, postgresAccepts) => {
    expect(parseSessionId(value)).toBeNull();
    expect(await postgresAcceptsAsUuid(value)).toBe(postgresAccepts);
  });

  it("never accepts a value Postgres rejects (400 random uuid look-alikes)", async () => {
    // Deterministic PRNG (mulberry32) so a failure reproduces.
    let state = 0x52_52_52;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (chars: string) => chars[Math.floor(random() * chars.length)]!;
    const HEX = "0123456789abcdefABCDEF";
    const NOT_ALL_HEX = HEX + "gGzZ-_ ";

    let acceptedByParser = 0;
    for (let i = 0; i < 400; i++) {
      const alphabet = random() < 0.7 ? HEX : NOT_ALL_HEX;
      const value = [8, 4, 4, 4, 12]
        .map((len) => {
          const n = random() < 1 / 6 ? len + (random() < 0.5 ? -1 : 1) : len;
          return Array.from({ length: n }, () => pick(alphabet)).join("");
        })
        .join("-");
      if (parseSessionId(value) !== null) {
        acceptedByParser++;
        expect(
          await postgresAcceptsAsUuid(value),
          `parseSessionId accepted ${JSON.stringify(value)} but Postgres rejects it`,
        ).toBe(true);
      }
    }
    // The loop must actually have exercised the accepted side.
    expect(acceptedByParser).toBeGreaterThan(50);
  }, 60_000);
});
