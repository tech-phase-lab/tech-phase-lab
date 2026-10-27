/** Fixed categories only. Never return/log cookie values, tokens, IDs or raw errors. */
export function sessionDiagnostic(headers: Headers) {
  const reason = headers.get("x-clerk-auth-reason");
  const allowed = new Set([
    "session-token-and-uat-missing", "session-token-missing", "session-token-expired",
    "client-uat-but-no-session-token", "session-token-but-no-client-uat",
    "session-token-iat-before-client-uat", "session-token-nbf", "session-token-iat-in-the-future",
    "token-type-mismatch", "unexpected-error", "satellite-needs-syncing",
  ]);
  const names = (headers.get("cookie") ?? "").split(";").map(part => part.trim().split("=", 1)[0]);
  return {
    reason: reason && allowed.has(reason) ? reason : "unclassified",
    middlewareSignedIn: headers.get("x-clerk-auth-status") === "signed-in",
    sessionCookiePresent: names.some(name => /^__session(?:_|$)/.test(name)),
    clientCookiePresent: names.some(name => /^__client_uat(?:_|$)/.test(name)),
  };
}
