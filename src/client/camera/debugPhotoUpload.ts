/**
 * Debug photos (Kirby 2026-10-27, candidate 未拍板): with
 * `?debug=1&photos=1` (never `?debug=1` alone), each
 * scan photo and its attempt record go to `/api/debug-photo`, which keeps
 * them only on a preview deployment (src/server/debug/debugPhoto.ts; 404
 * elsewhere, and then nothing more is sent this visit). The photo goes once;
 * later records of the same photo (the corners adjusted, a retake) go
 * without it, under the same id. Fire and forget: it never breaks a scan.
 */

let refused = false;
const sent = new WeakSet<File>();
const ids = new WeakMap<File, string>();

/** A short name for a photo, the same for all its records. */
function idOf(photo: File): string {
  let id = ids.get(photo);
  if (!id) {
    id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    ids.set(photo, id);
  }
  return id;
}

export function uploadDebugPhoto(
  photo: File | null,
  record: unknown,
  fetchImpl: typeof fetch = fetch,
): void {
  if (refused || !photo) return;
  try {
    const form = new FormData();
    form.set("id", idOf(photo));
    form.set("record", JSON.stringify(record));
    if (!sent.has(photo)) {
      form.set("photo", photo);
      sent.add(photo);
    }
    void fetchImpl("/api/debug-photo", { method: "POST", body: form })
      .then((response) => {
        if (response.status === 404) refused = true;
      })
      .catch(() => {
        // A debug photo that does not arrive is not a scan problem.
      });
  } catch {
    // Never breaks a scan.
  }
}
