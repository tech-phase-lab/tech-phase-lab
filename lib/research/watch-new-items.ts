/** First successful snapshot is a baseline, never an alert. Ignore older backfills. */
export function createWatchTracker(startedAt = Date.now()) {
  let seen: Set<string> | null = null;
  let newest = startedAt;
  return (rows: { id: string; at: string }[]) => {
    const fresh = seen === null ? [] : rows.filter(row => !seen!.has(row.id) && Date.parse(row.at) >= newest);
    seen ??= new Set();
    for (const row of rows) {
      seen.add(row.id);
      const at = Date.parse(row.at);
      if (Number.isFinite(at)) newest = Math.max(newest, at);
    }
    return fresh;
  };
}
