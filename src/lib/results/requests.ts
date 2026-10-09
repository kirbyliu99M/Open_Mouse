/**
 * The decisions behind "the fit is requested once per scan" and "the written
 * analysis is requested once, by the main page only". Pure, so both rules are
 * unit-tested; `ResultsScanProvider` only calls them.
 *
 * Why the fit needs a registry: Next.js runs React Strict Mode in development,
 * which runs an effect, cleans it up and runs it again at once. Without a
 * shared in-flight request that is two POSTs to `/fit`. With one, the second
 * run reuses the first run's promise, so development and production both POST
 * exactly once. An entry lives only while its request is in flight: a reload,
 * or coming back to the page later, makes a new request.
 */

/** The identity of one fit request: a scan, and how many times it was retried. */
export function fitRequestKey(scanId: string, attempt: number): string {
  return `${scanId}#${attempt}`;
}

export interface InflightRequests<T> {
  /**
   * The request for `key` if one is in flight, else the result of `start()`,
   * which is remembered until it settles (resolves or rejects).
   */
  getOrStart: (key: string, start: () => Promise<T>) => Promise<T>;
  /** How many requests are in flight. */
  size: () => number;
}

export function createInflightRequests<T>(): InflightRequests<T> {
  const inflight = new Map<string, Promise<T>>();
  return {
    getOrStart(key, start) {
      const existing = inflight.get(key);
      if (existing) return existing;
      const request = start();
      inflight.set(key, request);
      const forget = () => {
        // Only forget this request, not a newer one under the same key.
        if (inflight.get(key) === request) inflight.delete(key);
      };
      request.then(forget, forget);
      return request;
    },
    size: () => inflight.size,
  };
}

/**
 * Whether a page should ask for the written analysis now: only the main page
 * (rank 1) does, and only the first time for a scan (`started`), so moving to
 * a detail page and back does not ask again and a detail page never does.
 */
export function shouldRequestAnalysis({
  isMainPage,
  started,
}: {
  isMainPage: boolean;
  started: boolean;
}): boolean {
  return isMainPage && !started;
}
