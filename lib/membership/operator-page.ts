import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwnerAccount } from "./entitlements";

/**
 * Operator pages (/research/review, /research/editorial, /research/questions, /research/intake) are for the owner only.
 * Production QA, Nov 24: they were readable without signing in. Anyone else, signed out or not, gets the 404 page, so the
 * page neither renders nor says that it exists. Both owner accounts (production and preview) always keep access, also while
 * the owner is trying the app as FREE. Server use only: the user id comes from the verified Clerk session.
 */
export async function requireOperatorPage(): Promise<void> {
  const userId = await auth().then(session => session.userId, () => null);
  if (!isOwnerAccount(userId)) notFound();
}
