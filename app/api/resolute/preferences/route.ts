import { auth, clerkClient } from "@clerk/nextjs/server";
import { membershipConfigured } from "@/lib/membership/server";
import { createPreferencesHandlers } from "@/lib/resolute/preferences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createPreferencesHandlers({
  async authenticatedUser() {
    if (!membershipConfigured()) throw new Error("Authentication unavailable");
    return (await auth()).userId;
  },
  async read(userId) {
    return (await (await clerkClient()).users.getUser(userId)).publicMetadata;
  },
  async save(userId, preferences) {
    // Clerk deep-merges only these public keys. Membership and purchase rights are separate.
    return (await (await clerkClient()).users.updateUserMetadata(userId, {
      publicMetadata: { locale: preferences.locale, timezone: preferences.timezone },
    })).publicMetadata;
  },
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
