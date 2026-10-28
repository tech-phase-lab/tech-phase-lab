// Explicit Sandbox cohort only. Never accept IDs from cookies, URLs or requests.
// Invalid cohort configuration grants no additional access; the owner is retained.
export function sandboxMemberAllowed(env, ownerId, userId) {
  if (typeof userId !== 'string' || !userId) return false;
  if (userId === ownerId) return true;
  if (env.TECH_PHASE_PAYPAL_ENV !== 'sandbox' ||
      !(env.VERCEL_ENV === 'preview' || (env.TECH_PHASE_BILLING_RUNTIME === 'railway-sandbox' && env.RAILWAY_GIT_BRANCH === 'codex/research-preview'))) return false;
  const raw = env.TECH_PHASE_BILLING_SANDBOX_TEST_USERS;
  if (typeof raw !== 'string' || raw.length > 1024) return false;
  try {
    const users = JSON.parse(raw);
    if (!Array.isArray(users) || users.length > 5 || new Set(users).size !== users.length ||
        users.some(id => typeof id !== 'string' || !/^user_[A-Za-z0-9]{1,120}$/.test(id))) return false;
    return users.includes(userId);
  } catch { return false; }
}
