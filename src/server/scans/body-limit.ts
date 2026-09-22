/**
 * Request-body size cap for `POST /api/scans`. A payload carrying image
 * bytes must be refused before it is ever handed to JSON.parse — see the
 * fifth hard rule in AGENTS.md ("photos never leave the browser").
 */

/** 16 KB: comfortably above a real measurement payload, far below a photo. */
export const MAX_SCAN_BODY_BYTES = 16 * 1024;

export class BodyTooLargeError extends Error {}

/**
 * Reads `request.body` as text, refusing anything over `maxBytes`.
 *
 * Checks `Content-Length` first so a declared-oversized body is refused
 * without reading a single byte of it. Also counts bytes while streaming,
 * in case `Content-Length` is absent, wrong, or understated — the declared
 * length is never trusted on its own.
 */
export async function readLimitedBody(
  request: Request,
  maxBytes: number = MAX_SCAN_BODY_BYTES,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new BodyTooLargeError(
        `Request body of ${declaredBytes} bytes exceeds the ${maxBytes}-byte limit.`,
      );
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new BodyTooLargeError(
          `Request body exceeds the ${maxBytes}-byte limit.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}
