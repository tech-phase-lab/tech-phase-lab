/** Collects the keys asked for within a short window into one multi-symbol request (chunks of `size`, read one after another).
 * Each caller gets its own key's answer; a key the provider returned nothing for resolves to null, a failed request rejects every key in it.
 * Used behind a per-ticker cache: only the tickers that missed the cache reach this, so a different mix of holdings never re-reads a shared one. */
export function createBatcher<T>(fetchMany: (keys: string[]) => Promise<Map<string, T>>, size = 12, windowMs = 25) {
  type Waiter = { resolve: (value: T | null) => void; reject: (error: unknown) => void };
  let pending = new Map<string, Waiter[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    const batch = pending;
    pending = new Map();
    timer = null;
    const keys = [...batch.keys()];
    for (let i = 0; i < keys.length; i += size) {
      const chunk = keys.slice(i, i + size);
      try {
        const got = await fetchMany(chunk);
        for (const key of chunk) for (const waiter of batch.get(key)!) waiter.resolve(got.get(key) ?? null);
      } catch (error) {
        for (const key of chunk) for (const waiter of batch.get(key)!) waiter.reject(error);
      }
    }
  };

  return (key: string): Promise<T | null> => new Promise((resolve, reject) => {
    const waiters = pending.get(key);
    if (waiters) waiters.push({ resolve, reject }); else pending.set(key, [{ resolve, reject }]);
    timer ??= setTimeout(() => { void flush(); }, windowMs);
  });
}
