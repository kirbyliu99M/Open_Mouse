import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component; `next/cache` needs
// Next's runtime. Stub both so the module's own control flow runs here.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../src/server/log", () => ({ log: { warn } }));

import {
  MICE_LIST_REVALIDATE_S,
  MICE_LIST_TAG,
  getMiceList,
  loadMiceRows,
} from "../../src/server/catalogue/list-mice";
import { fakeDrizzleChain } from "./fixtures/fake-drizzle";

type FakeDb = Parameters<typeof loadMiceRows>[0];

const dbRow = (over: Record<string, unknown> = {}) => ({
  slug: "logitech-g-pro-x-superlight-2",
  brand: "Logitech",
  model: "G Pro X Superlight 2",
  size: "medium",
  shape: "symmetrical",
  connectivity: "wireless",
  lengthMm: 125,
  widthMm: 63.5,
  heightMm: 40,
  weightG: 60,
  ...over,
});

beforeEach(() => warn.mockClear());

describe("loadMiceRows", () => {
  it("selects the display columns only: no source address, data source or descriptor values", async () => {
    const chain = fakeDrizzleChain([dbRow()]);
    await loadMiceRows(chain as unknown as FakeDb);
    expect(chain.select).toHaveBeenCalledTimes(1);
    const selected = (chain.select as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(selected).sort()).toEqual(
      [
        "slug",
        "brand",
        "model",
        "size",
        "shape",
        "connectivity",
        "lengthMm",
        "widthMm",
        "heightMm",
        "weightG",
      ].sort(),
    );
    // Only listed rows: the one rule the fit service uses (`mice.listed`).
    expect(chain.where).toHaveBeenCalledTimes(1);
  });

  it("returns rows sorted by brand, then model, with fingertip counted as small", async () => {
    const chain = fakeDrizzleChain([
      dbRow({ slug: "r", brand: "Razer", model: "Viper" }),
      dbRow({ slug: "l2", model: "G Pro 10", size: "fingertip" }),
      dbRow({ slug: "l1", model: "G Pro 2" }),
    ]);
    const rows = await loadMiceRows(chain as unknown as FakeDb);
    expect(rows.map((r) => r.slug)).toEqual(["l1", "l2", "r"]);
    expect(rows[1]!.size).toBe("small");
  });

  it("drops anything the query returned beyond the display fields", async () => {
    const chain = fakeDrizzleChain([
      dbRow({ sourceUrl: "https://x.example", dataSource: "first_party" }),
    ]);
    const [row] = await loadMiceRows(chain as unknown as FakeDb);
    expect(Object.keys(row!)).toHaveLength(10);
    expect(JSON.stringify(row)).not.toContain("x.example");
  });
});

describe("getMiceList", () => {
  it("is ok with the rows when the read works", async () => {
    const rows = [
      {
        slug: "a",
        brand: "A",
        model: "B",
        size: "small" as const,
        shape: null,
        connectivity: null,
        lengthMm: 1,
        widthMm: 1,
        heightMm: 1,
        weightG: null,
      },
    ];
    expect(await getMiceList(async () => rows)).toEqual({
      status: "ok",
      rows,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not throw when the read fails: an empty, unavailable result, logged without the error text", async () => {
    const result = await getMiceList(async () => {
      throw new Error("connection string postgres://user:secret@host/db");
    });
    expect(result).toEqual({ status: "unavailable", rows: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });

  it("caches for an hour under a tag", () => {
    expect(MICE_LIST_REVALIDATE_S).toBe(3600);
    expect(MICE_LIST_TAG).toBe("mice-list");
  });
});
