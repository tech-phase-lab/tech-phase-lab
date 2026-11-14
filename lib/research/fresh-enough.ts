/** The cache answers with its old entry while it refreshes in the background, so the first reader after a quiet spell got figures days old,
 * which the factors then rightly refused (AAOI's momentum and P/E stayed "—" on Nov 14). An entry older than the factor allows is read again now. */
export async function freshEnough<T>(cachedRead: () => Promise<T>, directRead: () => Promise<T>, maxAgeMs: number, stamp: (value: T) => string | undefined = value => (value as { retrievedAt?: string }).retrievedAt, now = Date.now): Promise<T> {
  const value = await cachedRead();
  const at = Date.parse(stamp(value) ?? "");
  return Number.isFinite(at) && now() - at <= maxAgeMs ? value : directRead();
}
