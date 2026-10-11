/**
 * The two reads the profile page makes for itself, over a real Postgres
 * (PGlite with the repo's own migrations): the signed-in person's own e-mail
 * (never anyone else's) and the catalogue's "Brand Model" names by slug (and
 * nothing else of a row).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readAccountEmail,
  readMouseNames,
} from "../../src/server/account/profile";
import { migratedDatabase } from "./fixtures/pglite";

type ProfileDb = NonNullable<Parameters<typeof readAccountEmail>[1]>;

async function world() {
  const { pg, db } = await migratedDatabase();
  return { pg, db: db as unknown as ProfileDb };
}

describe("readAccountEmail", () => {
  it("returns the e-mail of the user id it is given, and no other user's", async () => {
    const { pg, db } = await world();
    await pg.query(
      `INSERT INTO users (id, name, email) VALUES
         ('user-a', 'A', 'a@example.test'),
         ('user-b', 'B', 'b@example.test')`,
    );
    expect(await readAccountEmail("user-a", db)).toBe("a@example.test");
    expect(await readAccountEmail("user-b", db)).toBe("b@example.test");
  });

  it("is null for an id that does not exist", async () => {
    const { pg, db } = await world();
    await pg.query(
      `INSERT INTO users (id, name, email) VALUES ('user-a', 'A', 'a@example.test')`,
    );
    expect(await readAccountEmail("nobody", db)).toBeNull();
    expect(await readAccountEmail("", db)).toBeNull();
  });

  it("is null for a user who has no e-mail", async () => {
    const { pg, db } = await world();
    await pg.query(`INSERT INTO users (id, name) VALUES ('user-c', 'C')`);
    expect(await readAccountEmail("user-c", db)).toBeNull();
  });
});

describe("readMouseNames", () => {
  async function seed() {
    const { pg, db } = await world();
    for (const [slug, brand, model, listed] of [
      [
        "logitech-g-pro-x-superlight-2",
        "Logitech",
        "G Pro X Superlight 2",
        true,
      ],
      ["razer-deathadder-v3", "Razer", "DeathAdder V3", true],
      // Unlisted rows keep their names, so an old answer still shows one.
      ["logitech-m705", "Logitech", "Logitech M705", false],
    ] as const) {
      await pg.query(
        `INSERT INTO mice (slug, brand, model, length_mm, width_mm, height_mm, size, source_url, spec_retrieved_at, listed)
         VALUES ($1, $2, $3, 120, 65, 40, 'medium', 'https://example.test', now(), $4)`,
        [slug, brand, model, listed],
      );
    }
    return db;
  }

  it("maps each slug to 'Brand Model', unlisted rows included, and says the brand once", async () => {
    const names = await readMouseNames(await seed());
    expect(names).toEqual({
      "logitech-g-pro-x-superlight-2": "Logitech G Pro X Superlight 2",
      "razer-deathadder-v3": "Razer DeathAdder V3",
      // The model already starts with the brand: not "Logitech Logitech M705".
      "logitech-m705": "Logitech M705",
    });
  });

  it("holds nothing but the name of each mouse: no dimension, link or id leaks into the answer", async () => {
    const names = await readMouseNames(await seed());
    const text = JSON.stringify(names);
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("120");
    for (const value of Object.values(names))
      expect(typeof value).toBe("string");
  });

  it("is empty for an empty catalogue", async () => {
    const { db } = await world();
    expect(await readMouseNames(db)).toEqual({});
  });
});
