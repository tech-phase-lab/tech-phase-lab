import "server-only";
import { fetchResoluteEntitlements } from "./transport";

/** Vercel forwards a server-obtained session JWT, never a browser-selected ID. */
export async function getResoluteEntitlementsForSession(token: string) {
  return fetchResoluteEntitlements(token, process.env.RESOLUTE_API_URL,
    process.env.RESOLUTE_API_SERVICE_TOKEN);
}
