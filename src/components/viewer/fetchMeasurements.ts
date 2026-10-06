/**
 * Reads back the millimetres a scan stored, for the 3D viewer to scale its
 * hand (`GET /api/scans/{scanId}/measurements`, routes.ts). Plain function
 * with an injectable fetch so a unit test can drive every outcome.
 *
 * Only derived millimetres come back; no image is involved anywhere in this
 * path (hard rule 5). The body is parsed with the contract's schema, and a
 * body that does not match is treated like a failure, never trusted.
 */
import {
  scanMeasurementsResponseSchema,
  type ScanMeasurementsResponse,
} from "@/lib/contracts/measurement";
import { scanMeasurementsPath } from "@/lib/contracts/routes";

export type MeasurementsOutcome =
  | { status: "ready"; response: ScanMeasurementsResponse }
  | { status: "notFound" }
  | { status: "rateLimited" }
  | { status: "error" };

export async function fetchScanMeasurements(
  scanId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<MeasurementsOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(scanMeasurementsPath(scanId), {
      method: "GET",
      credentials: "same-origin",
      signal,
    });
  } catch {
    return { status: "error" };
  }
  if (res.status === 404) return { status: "notFound" };
  if (res.status === 429) return { status: "rateLimited" };
  if (!res.ok) return { status: "error" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "error" };
  }
  const parsed = scanMeasurementsResponseSchema.safeParse(json);
  if (!parsed.success) return { status: "error" };
  return { status: "ready", response: parsed.data };
}
