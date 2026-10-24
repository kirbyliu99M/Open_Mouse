import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The choice must survive a browser that refuses to store it (the banner still
// closes, a withdrawal still takes effect on this page), and must not outlive a
// store that was cleared (another tab, "clear site data").
function fakeStorage(opts: { failWrites?: boolean; failReads?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    api: {
      getItem: (key: string) => {
        if (opts.failReads) throw new Error("blocked");
        return data.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (opts.failWrites) throw new Error("quota");
        data.set(key, value);
      },
    },
  };
}

async function load(opts?: Parameters<typeof fakeStorage>[0]) {
  vi.resetModules();
  const store = fakeStorage(opts);
  vi.stubGlobal("window", {
    localStorage: store.api,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  const mod = await import("@/client/consent/consent");
  return { mod, store };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the consent choice", () => {
  it("is none until one is made, then what was stored", async () => {
    const { mod, store } = await load();
    expect(mod.readConsent()).toBeNull();
    mod.setConsent("granted");
    expect(mod.readConsent()).toBe("granted");
    expect(store.data.get(mod.CONSENT_STORAGE_KEY)).toBe("granted");
  });

  it("is none again when the store is cleared (another tab)", async () => {
    const { mod, store } = await load();
    mod.setConsent("granted");
    store.data.clear();
    expect(mod.readConsent()).toBeNull();
  });

  it("is kept for this page when the store refuses writes, so a withdrawal still counts", async () => {
    const { mod } = await load({ failWrites: true });
    mod.setConsent("granted");
    expect(mod.readConsent()).toBe("granted");
    mod.setConsent("denied");
    expect(mod.readConsent()).toBe("denied");
  });

  it("is kept for this page when the store cannot even be read", async () => {
    const { mod } = await load({ failWrites: true, failReads: true });
    expect(mod.readConsent()).toBeNull();
    mod.setConsent("denied");
    expect(mod.readConsent()).toBe("denied");
  });
});
