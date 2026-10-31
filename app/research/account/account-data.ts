/** Browser side of the account APIs (docs/ACCOUNT-API-HANDOFF-2026-10-31.md). Nothing here guesses a value. */
export type Profile = {
  displayName: string; email: string | null; plan: "free" | "pro" | "owner"; ownerAccess: boolean;
  passwordEnabled: boolean; twoFactorEnabled: boolean; icon: string; iconEditable: boolean;
};
export type Contract = {
  accessPlan: "free" | "pro" | null; verification: "verified" | "pending" | "unavailable";
  status: "active" | "renewal-stopped" | "none" | null; autoRenew: boolean | null;
  amount: string | null; currency: "JPY" | "USD" | null; nextBillingAt: string | null; accessExpiresAt: string | null;
  unavailableFields: string[];
};

const isDate = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
export function readProfile(value: unknown): Profile {
  const v = value as Partial<Profile> | null;
  if (!v || typeof v.displayName !== "string" || !["free", "pro", "owner"].includes(v.plan as string) || typeof v.icon !== "string" || typeof v.passwordEnabled !== "boolean" || typeof v.twoFactorEnabled !== "boolean") throw Error("profile");
  return { displayName: v.displayName, email: typeof v.email === "string" ? v.email : null, plan: v.plan as Profile["plan"], ownerAccess: v.ownerAccess === true,
    passwordEnabled: v.passwordEnabled === true, twoFactorEnabled: v.twoFactorEnabled === true, icon: v.icon, iconEditable: v.iconEditable === true };
}
export function readContract(value: unknown): Contract {
  const v = value as Partial<Contract> | null;
  if (!v || !["verified", "pending", "unavailable"].includes(v.verification as string) || ![null, "active", "renewal-stopped", "none"].includes(v.status as never)) throw Error("contract");
  return { accessPlan: v.accessPlan === "free" || v.accessPlan === "pro" ? v.accessPlan : null, verification: v.verification as Contract["verification"], status: v.status ?? null,
    autoRenew: typeof v.autoRenew === "boolean" ? v.autoRenew : null, amount: typeof v.amount === "string" && v.amount ? v.amount : null,
    currency: v.currency === "JPY" || v.currency === "USD" ? v.currency : null, nextBillingAt: isDate(v.nextBillingAt) ? (v.nextBillingAt as string) : null,
    accessExpiresAt: isDate(v.accessExpiresAt) ? (v.accessExpiresAt as string) : null, unavailableFields: Array.isArray(v.unavailableFields) ? v.unavailableFields.filter(x => typeof x === "string") : [] };
}
/** The contract card needs every value it prints. Anything missing means "could not check", never a guess. */
export function contractComplete(contract: Contract) {
  if (contract.verification !== "verified") return false;
  if (contract.status === "active") return !!contract.amount && !!contract.currency && !!contract.nextBillingAt;
  if (contract.status === "renewal-stopped") return !!contract.amount && !!contract.currency && !!contract.accessExpiresAt;
  return contract.status === "none";
}
export async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(Error("request"), { status: response.status });
  return response.json();
}
export async function patchProfile(body: { displayName?: string; icon?: string }) {
  const response = await fetch("/api/research/account/profile", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(Error("patch"), { status: response.status });
  return readProfile(await response.json());
}
export const formatDay = (iso: string | null | undefined, ja: boolean) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(ms) : null;
};
export const formatAmount = (amount: string, currency: "JPY" | "USD") => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return currency === "JPY" ? `¥${Math.round(n).toLocaleString("ja-JP")}` : `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;
};
/** am***@gmail.com: the first two characters of the local part, then the domain. */
export function maskEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 1) return email ? "***" : "";
  const local = Array.from(email.slice(0, at));
  return `${local.slice(0, Math.min(2, local.length)).join("")}***${email.slice(at)}`;
}
