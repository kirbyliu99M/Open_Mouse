/**
 * Debug photos on a preview (Kirby 2026-10-27, candidate 未拍板): with
 * `?debug=1&photos=1` on a PREVIEW deployment, each scan photo and its attempt record
 * are kept in a private Vercel Blob store, so a failed scan on his phone can
 * be looked at afterwards. Kept under `debug/<deployment>/`, and removed with
 * that preview. Never on production: the store is connected to the preview
 * environment only, and this handler answers 404 anywhere else.
 */

/** The largest photo taken (a 1024x1920 JPEG is ~300 KB; the body limit is 4.5 MB). */
export const DEBUG_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
/** The largest record taken (an attempt record is a few KB). */
export const DEBUG_RECORD_MAX_BYTES = 256 * 1024;

export interface DebugPhotoEnv {
  readonly VERCEL_ENV?: string;
  readonly VERCEL_URL?: string;
  readonly BLOB_READ_WRITE_TOKEN?: string;
}

export type DebugPut = (
  pathname: string,
  body: Blob | string,
  contentType: string,
) => Promise<void>;

/** The folder of this deployment: the first label of its URL (`open-mouse-abc123-...`). */
export function debugFolderOf(vercelUrl: string | undefined): string | null {
  const label = (vercelUrl ?? "").split(".")[0] ?? "";
  return /^[a-z0-9-]{1,100}$/.test(label) ? `debug/${label}` : null;
}

/** Whether this deployment takes debug photos: a preview with the store. */
export function debugPhotosOn(env: DebugPhotoEnv): boolean {
  return (
    env.VERCEL_ENV === "preview" &&
    Boolean(env.BLOB_READ_WRITE_TOKEN) &&
    debugFolderOf(env.VERCEL_URL) !== null
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * POST multipart: `record` (JSON text, required), `photo` (a JPEG, optional:
 * a later record of the same photo comes without it), `id` (the client's
 * name for the photo, so a record and its photo share a name).
 */
export async function handleDebugPhoto(
  request: Request,
  deps: { readonly env: DebugPhotoEnv; readonly put: DebugPut },
): Promise<Response> {
  if (!debugPhotosOn(deps.env)) return json(404, { error: "not_found" });
  const folder = debugFolderOf(deps.env.VERCEL_URL) as string;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "bad_form" });
  }
  const id = form.get("id");
  const record = form.get("record");
  const photo = form.get("photo");
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
    return json(400, { error: "bad_id" });
  if (typeof record !== "string" || record.length > DEBUG_RECORD_MAX_BYTES)
    return json(400, { error: "bad_record" });
  try {
    JSON.parse(record);
  } catch {
    return json(400, { error: "bad_record" });
  }
  if (photo !== null) {
    if (
      !(photo instanceof Blob) ||
      photo.type !== "image/jpeg" ||
      photo.size > DEBUG_PHOTO_MAX_BYTES
    )
      return json(400, { error: "bad_photo" });
  }
  const stamp = Date.now();
  await deps.put(`${folder}/${id}-${stamp}.json`, record, "application/json");
  if (photo instanceof Blob)
    await deps.put(`${folder}/${id}.jpg`, photo, "image/jpeg");
  return json(200, { ok: true });
}
