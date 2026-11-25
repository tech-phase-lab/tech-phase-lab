import "server-only";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getMembership } from "./server";
import { proPageAllowed, type PageMember } from "./pro-access";

/**
 * The first statement of a PRO-only page: checks the verified session on the server, before any data is read or rendered,
 * and sends everyone else to `fallback` (a FREE page). Nothing of the PRO page reaches the browser, so there is no flash.
 */
export async function requireProPage(fallback: string): Promise<PageMember> {
  await connection();
  const member: PageMember = await getMembership().catch(() => ({ status: "unavailable", plan: "free" }));
  if (!proPageAllowed(member)) redirect(fallback);
  return member;
}
