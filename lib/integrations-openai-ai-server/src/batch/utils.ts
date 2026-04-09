import pLimit from "p-limit";
import pRetry, { AbortError } from "p-retry";

export interface BatchOptions {
  concurrency?: number;
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  onProgress?: (completed: number, total: number, item: unknown) => void;
}

export function isRateLimitError(error: unknown): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return (
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("quota") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: BatchOptions = {}
): Promise<R[]> {
  const {
    concurrency = 2,
    retries = 7,
    minTimeout = 2000,
    maxTimeout = 128000,
    onProgress,
  } = options;

  const limit = pLimit(concurrency);
  let completed = 0;

  const promises = items.map((item, index) =>
    limit(() =>
      pRetry(
        async () => {
          try {
            const result = await processor(item, index);
            completed++;
            onProgress?.(completed, items.length, item);
            return result;
          } catch (error: unknown) {
            if (isRateLimitError(error)) {
              throw error;
            }
            throw new AbortError(
              error instanceof Error ? error.message : String(error)
            );
          }
        },
        { retries, minTimeout, maxTimeout, factor: 2 }
      )
    )
  );

  return Promise.all(promises);
}
