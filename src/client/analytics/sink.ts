/**
 * Where events wait until posthog-js has loaded (it is imported after first
 * idle), then go straight through. Pure and injectable so it can be tested.
 */
export interface Capturer {
  capture(name: string, props: Record<string, unknown>): unknown;
}

export const MAX_QUEUE = 50;

export function createSink(maxQueue: number = MAX_QUEUE) {
  let client: Capturer | null = null;
  let dead = false;
  const queue: Array<[string, Record<string, unknown>]> = [];
  return {
    send(name: string, props: Record<string, unknown>): void {
      if (client) {
        client.capture(name, props);
        return;
      }
      if (!dead && queue.length < maxQueue) queue.push([name, props]);
    },
    /** The client loaded: flush what waited, in order. */
    ready(loaded: Capturer): void {
      client = loaded;
      for (const [name, props] of queue.splice(0)) loaded.capture(name, props);
    },
    /** The load failed: analytics stays off, nothing is kept. */
    failed(): void {
      dead = true;
      queue.length = 0;
    },
    size: () => queue.length,
  };
}
