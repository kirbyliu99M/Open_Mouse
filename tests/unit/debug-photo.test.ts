import { describe, expect, it, vi } from "vitest";
import {
  debugFolderOf,
  debugPhotosOn,
  handleDebugPhoto,
  type DebugPhotoEnv,
} from "@/server/debug/debugPhoto";
import { uploadDebugPhoto } from "@/client/camera/debugPhotoUpload";

const PREVIEW: DebugPhotoEnv = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "open-mouse-abc123-kirby-at-ntu.vercel.app",
  BLOB_READ_WRITE_TOKEN: "token",
};

const post = (fields: Record<string, string | Blob>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("https://x/api/debug-photo", {
    method: "POST",
    body: form,
  });
};

const jpeg = () =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

describe("debug photos on a preview (Kirby 2026-10-27)", () => {
  it("only a preview with the store takes them; production never does", () => {
    expect(debugPhotosOn(PREVIEW)).toBe(true);
    expect(debugPhotosOn({ ...PREVIEW, VERCEL_ENV: "production" })).toBe(false);
    expect(debugPhotosOn({ ...PREVIEW, VERCEL_ENV: undefined })).toBe(false);
    expect(debugPhotosOn({ ...PREVIEW, BLOB_READ_WRITE_TOKEN: "" })).toBe(
      false,
    );
    expect(debugFolderOf(PREVIEW.VERCEL_URL)).toBe(
      "debug/open-mouse-abc123-kirby-at-ntu",
    );
    expect(debugFolderOf("../evil")).toBeNull();
  });

  it("production answers 404 and stores nothing", async () => {
    const put = vi.fn();
    const res = await handleDebugPhoto(post({ id: "a", record: "{}" }), {
      env: { ...PREVIEW, VERCEL_ENV: "production" },
      put,
    });
    expect(res.status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps the record and the photo under this deployment's folder", async () => {
    const put = vi.fn(async () => {});
    const res = await handleDebugPhoto(
      post({ id: "shot-1", record: '{"result":"ok"}', photo: jpeg() }),
      { env: PREVIEW, put },
    );
    expect(res.status).toBe(200);
    const paths = put.mock.calls.map((c) => (c as unknown[])[0]);
    expect(paths[0]).toMatch(
      /^debug\/open-mouse-abc123-kirby-at-ntu\/shot-1-\d+\.json$/,
    );
    expect(paths[1]).toBe("debug/open-mouse-abc123-kirby-at-ntu/shot-1.jpg");
  });

  it("turns back a bad id, a record that is not JSON, or a photo that is not a JPEG", async () => {
    const put = vi.fn(async () => {});
    const deps = { env: PREVIEW, put };
    expect(
      (await handleDebugPhoto(post({ id: "../x", record: "{}" }), deps)).status,
    ).toBe(400);
    expect(
      (await handleDebugPhoto(post({ id: "a", record: "nope" }), deps)).status,
    ).toBe(400);
    expect(
      (
        await handleDebugPhoto(
          post({
            id: "a",
            record: "{}",
            photo: new Blob(["x"], { type: "image/png" }),
          }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it("the page sends the photo once, then records only, and stops after a 404", async () => {
    const bodies: FormData[] = [];
    let status = 200;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(init?.body as FormData);
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    const photo = new File([jpeg()], "p.jpg", { type: "image/jpeg" });
    uploadDebugPhoto(photo, { n: 1 }, fetchImpl);
    uploadDebugPhoto(photo, { n: 2 }, fetchImpl);
    await Promise.resolve();
    expect(bodies[0]?.get("photo")).not.toBeNull();
    expect(bodies[1]?.get("photo")).toBeNull();
    expect(bodies[0]?.get("id")).toBe(bodies[1]?.get("id"));
    status = 404;
    uploadDebugPhoto(photo, { n: 3 }, fetchImpl);
    await new Promise((r) => setTimeout(r, 0));
    uploadDebugPhoto(photo, { n: 4 }, fetchImpl);
    expect(bodies).toHaveLength(3);
  });

  it("the scan page sends them only with ?debug=1&photos=1", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    expect(source).toMatch(
      /if \(photosDebugRef\.current\)\s*uploadDebugPhoto\(debugPhotoRef\.current, \{/,
    );
    expect(source).toContain(
      'photosDebugRef.current = on && params.get("photos") === "1";',
    );
  });
});
