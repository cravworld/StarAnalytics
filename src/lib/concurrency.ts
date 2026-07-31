// Bounded-concurrency pool — runs `worker` over `items` with at most `limit` in flight at
// once. Used to parallelize Claude classification batches (and similar per-item async work)
// instead of awaiting them one at a time: on Vercel Pro's raised maxDuration ceiling, wall
// clock per invocation is the throughput bottleneck, not cost — see commentSentiment.ts.
// Bounded (not unlimited) to avoid thrashing against the provider's own rate limits, which
// budget doesn't remove.
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function runner(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}
