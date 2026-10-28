import "server-only";
import { getMembership } from "./server";
import { auth } from "@clerk/nextjs/server";
import { OWNER_ACCOUNT_ID } from "./entitlements";
import { billingGateway } from "@/services/tech-phase-billing/transport.mjs";
export const handleSandboxBilling = billingGateway({
  env: process.env,
  ownerId: OWNER_ACCOUNT_ID,
  identity: async () => {
    if (process.env.TECH_PHASE_REQUIRE_ADMIN_MFA === "true") {
      const member = await getMembership();
      return member.status === "signed-in" && !member.adminMfaRequired ? member.userId : null;
    }
    return (await auth()).userId;
  },
});
