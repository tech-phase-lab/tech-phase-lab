import "server-only";
import { auth } from "@clerk/nextjs/server";
import { OWNER_ACCOUNT_ID } from "./entitlements";
import { billingGateway } from "@/services/tech-phase-billing/transport.mjs";
export const handleSandboxBilling = billingGateway({
  env: process.env,
  ownerId: OWNER_ACCOUNT_ID,
  identity: async () => (await auth()).userId,
});
