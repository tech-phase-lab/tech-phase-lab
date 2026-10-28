import { isOwnerAccount } from "../membership/entitlements.ts";
/** Review is separate from purchase entitlements and exists only on preview deployments. */
export function canReviewResolute(userId: string | null | undefined, environment: string | undefined) {
 return environment === "preview" && isOwnerAccount(userId);
}
