import "server-only";
import { cookies } from "next/headers";
import { displayCookie, signDisplay, type Display } from "./display-token";
/** Presentation only: protected endpoints always verify current membership independently. */
export async function saveMemberDisplay(member?: Display & { userId: string }) {
  const secret = process.env.CLERK_SECRET_KEY;
  (await cookies()).set(displayCookie, member && secret ? signDisplay(member, member.userId, secret) : "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: member && secret ? 300 : 0,
  });
}
