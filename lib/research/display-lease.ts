/** Refresh before the server lease ends, without extending its authorization. */
export function scheduleLeaseRenewal(validUntil: number, renew: () => void, expire: () => void) {
  const remaining = Math.max(0, validUntil - Date.now());
  const renewal = setTimeout(renew, Math.max(0, Math.min(60_000, remaining - 20_000)));
  const expiry = setTimeout(expire, Math.min(remaining, 2_147_483_647));
  return () => { clearTimeout(renewal); clearTimeout(expiry); };
}
