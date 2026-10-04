import "server-only";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { displayCookie, signDisplay, verifyDisplay, type Display } from "./display-token";
import { membershipConfigured } from "./server";
/** Presentation only: protected endpoints always verify current membership independently. */
export async function initialMemberDisplay() {
  if (!membershipConfigured()) return;
  const token = (await cookies()).get(displayCookie)?.value;
  if (!token) return;
  const { userId } = await auth();
  if (!userId) return;
  return verifyDisplay(token, userId, process.env.CLERK_SECRET_KEY!);
}
export async function saveMemberDisplay(member?: Display & { userId: string }) {
  const secret = process.env.CLERK_SECRET_KEY;
  (await cookies()).set(displayCookie, member && secret ? signDisplay(member, member.userId, secret) : "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: member && secret ? 300 : 0,
  });
}
