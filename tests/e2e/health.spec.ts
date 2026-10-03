import { expect, test } from "@playwright/test";

/**
 * GET /api/health against the real dev server. Whether the database is
 * reachable depends on where this runs (CI has none), so both answers are
 * accepted; what must hold either way is the shape, the status code that goes
 * with the database state, and that nothing may be cached. The behaviour
 * behind it is covered by tests/unit/health*.test.ts.
 */
test("GET /api/health answers { status, version, db } and is never cached", async ({
  request,
}) => {
  const res = await request.get("/api/health");
  expect([200, 503]).toContain(res.status());
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(res.headers()["content-type"]).toContain("application/json");

  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["db", "status", "version"]);
  expect(body.version).toMatch(/^(dev|[0-9a-f]{7})$/);
  if (res.status() === 200) {
    expect(body).toMatchObject({ status: "ok", db: "ok" });
  } else {
    expect(body).toMatchObject({ status: "degraded", db: "unavailable" });
  }
});
