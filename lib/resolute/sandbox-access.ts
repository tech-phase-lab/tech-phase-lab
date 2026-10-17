// Server-configured admission only. This never grants PRO pricing or product access.
export function sandboxTester(env: Record<string, string | undefined>, now = Date.now()): string | null {
  const id = env.RESOLUTE_SANDBOX_TEST_USER_ID;
  const until = env.RESOLUTE_SANDBOX_TEST_UNTIL;
  if (!id || !/^user_[A-Za-z0-9]{1,128}$/.test(id) || !until ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(until)) return null;
  const expires = Date.parse(until);
  return Number.isFinite(now) && Number.isFinite(expires) && expires > now ? id : null;
}
