/**
 * `GET /api/auth/session` through the real Auth.js handler from `src/auth.ts`
 * (issue #136). With the database strategy the `session` callback receives the
 * adapter's session row, and what it returns is the response body, readable by
 * any script on the page. The body must carry nothing but an allow-list, and
 * above all not the raw session token. The adapter is the real Drizzle adapter
 * on PGlite with the repo's migrations.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { NextRequest } from "next/server";
import { migratedDatabase } from "./fixtures/pglite";
import { toPublicSession } from "../../src/server/auth/session";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const TOKEN = "raw-session-token-that-must-not-leak";
let pg: PGlite;
let handlers: typeof import("../../src/auth").handlers;

vi.mock("../../src/db/client", () => ({
  getDb: () => testDb,
}));
let testDb: object;

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-for-the-session-callback-test";
  process.env.AUTH_TRUST_HOST = "true";
  const migrated = await migratedDatabase();
  pg = migrated.pg;
  testDb = migrated.db;
  await pg.query(
    `insert into users (id, name, email, image) values ('user-1', 'Real Name', 'real@example.test', 'https://example.test/me.png')`,
  );
  await pg.query(
    `insert into auth_sessions (session_token, user_id, expires) values ($1, 'user-1', now() + interval '1 day')`,
    [TOKEN],
  );
  ({ handlers } = await import("../../src/auth"));
}, 60_000);
afterAll(() => pg.close());

function sessionRequest(token: string | null): NextRequest {
  return new NextRequest("http://localhost/api/auth/session", {
    headers: token ? { cookie: `authjs.session-token=${token}` } : {},
  });
}

describe("GET /api/auth/session", () => {
  it("returns exactly expires and user.{id,name,image}: no sessionToken, no userId, no email", async () => {
    const res = await handlers.GET(sessionRequest(TOKEN));

    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expires", "user"]);
    expect(body.user).toEqual({
      id: "user-1",
      name: "Real Name",
      image: "https://example.test/me.png",
    });
    expect(typeof body.expires).toBe("string");
    // Nowhere in the body, under any key.
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/sessionToken|userId/);
    expect(text).not.toContain("real@example.test");
  });

  it("returns null for a token the database does not know", async () => {
    const res = await handlers.GET(sessionRequest("some-other-token"));

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns null when there is no cookie", async () => {
    const res = await handlers.GET(sessionRequest(null));

    expect(await res.json()).toBeNull();
  });
});

describe("toPublicSession", () => {
  it("copies only expires, user.id, name and image, whatever else the input carries", () => {
    const leaky = {
      expires: "2026-10-08T00:00:00.000Z",
      sessionToken: TOKEN,
      userId: "user-1",
      user: { id: "x", name: "n", email: "e" },
    };

    const out = toPublicSession(leaky, {
      id: "user-1",
      ...{ email: "e", name: "n" },
    });

    expect(out).toEqual({
      expires: "2026-10-08T00:00:00.000Z",
      user: { id: "user-1", name: "n", image: null },
    });
    expect(JSON.stringify(out)).not.toMatch(/sessionToken|userId|"e"/);
  });

  it("passes name and image through, and null when absent", () => {
    const expires = "2026-10-08T00:00:00.000Z";
    expect(
      toPublicSession(
        { expires },
        { id: "u", name: "A", image: "https://x/y" },
      ),
    ).toEqual({ expires, user: { id: "u", name: "A", image: "https://x/y" } });
    expect(toPublicSession({ expires }, { id: "u" }).user).toEqual({
      id: "u",
      name: null,
      image: null,
    });
    expect(
      toPublicSession({ expires }, { id: "u", name: null, image: null }).user,
    ).toEqual({ id: "u", name: null, image: null });
  });
});
