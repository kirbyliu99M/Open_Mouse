import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component; `next/cache` needs
// Next's runtime. Stub both so the module's own control flow runs here. The
// stub of `unstable_cache` records its arguments (what the page asks Next to
// cache) and runs the function as it is, so what the cached function does is
// tested too.
vi.mock("server-only", () => ({}));
const cache = vi.hoisted(() => ({
  calls: [] as unknown[][],
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown, ...rest: unknown[]) => {
    cache.calls.push([fn, ...rest]);
    return fn;
  },
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../src/server/log", () => ({ log: { warn } }));
// The database the default (cached) read opens: a chain whose rows each test sets.
const dbState = vi.hoisted(() => ({ rows: [] as unknown[], opened: 0 }));
vi.mock("../../src/db/client", async () => {
  const { fakeDrizzleChain } = await import("./fixtures/fake-drizzle");
  return {
    getDb: () => {
      dbState.opened += 1;
      return fakeDrizzleChain(dbState.rows);
    },
  };
});

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
  formFactor: "standard",
  ...over,
});

beforeEach(() => {
  warn.mockClear();
  dbState.rows = [];
  dbState.opened = 0;
});

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
        // Read only to leave vertical mice and trackballs out; never copied onto the page's row.
        "formFactor",
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

  it("leaves out vertical mice and trackballs (EXCLUDED_FORM_FACTORS), and the form factor does not reach the row", async () => {
    const chain = fakeDrizzleChain([
      dbRow({ slug: "std-a", model: "A" }),
      dbRow({ slug: "vert", model: "V", formFactor: "vertical" }),
      dbRow({ slug: "ball", model: "T", formFactor: "trackball" }),
      dbRow({ slug: "std-b", model: "B" }),
    ]);
    const rows = await loadMiceRows(chain as unknown as FakeDb);
    expect(rows.map((r) => r.slug)).toEqual(["std-a", "std-b"]);
    expect(rows.every((r) => !("formFactor" in r))).toBe(true);
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

  it("hands Next a cache of one hour under the tag mice-list", () => {
    expect(MICE_LIST_REVALIDATE_S).toBe(3600);
    expect(MICE_LIST_TAG).toBe("mice-list");
    expect(cache.calls).toHaveLength(1);
    const [fn, keyParts, options] = cache.calls[0]!;
    expect(fn).toBeTypeOf("function");
    expect(keyParts).toEqual(["mice-list-v1"]);
    expect(options).toEqual({ revalidate: 3600, tags: ["mice-list"] });
  });

  it("the cached read throws on 0 rows (so Next stores nothing) and the page then shows the empty state", async () => {
    const [cached] = cache.calls[0]! as [() => Promise<unknown>];
    dbState.rows = [];
    await expect(cached()).rejects.toThrow();
    // Through the page's entry point: unavailable, not an error, and nothing was cached.
    expect(await getMiceList()).toEqual({ status: "unavailable", rows: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("the cached read returns the rows when there are some", async () => {
    dbState.rows = [dbRow({ slug: "b", brand: "Razer" }), dbRow({ slug: "a" })];
    const result = await getMiceList();
    expect(result.status).toBe("ok");
    expect(result.rows.map((r) => r.slug)).toEqual(["a", "b"]);
    expect(dbState.opened).toBe(1);
  });

  it("the page's list, and so its count, is without the excluded form factors", async () => {
    dbState.rows = [
      dbRow({ slug: "a" }),
      dbRow({ slug: "v", formFactor: "vertical" }),
      dbRow({ slug: "t", formFactor: "trackball" }),
    ];
    const result = await getMiceList();
    expect(result.rows.map((r) => r.slug)).toEqual(["a"]);
  });
});
