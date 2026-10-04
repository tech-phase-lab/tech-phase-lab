import { clerkClient } from "@clerk/nextjs/server";
import { getMembership } from "@/lib/membership/server";
import { resolvePlan } from "@/lib/membership/entitlements";
import { memberCsv } from "@/lib/membership/csv";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = {"Cache-Control":"private, no-store", Vary:"Cookie"};
  try {
    const member = await getMembership();
    if (!("isAdmin" in member) || !member.isAdmin) return new Response("Forbidden", {status:403, headers});
    const client = await clerkClient();
    const rows: unknown[][] = [["会員ID", "登録日時（UTC）", "メールアドレス", "メール確認済み", "表示名", "プラン", "PRO有効期限", "最終ログイン（UTC）"]];
    for (let offset = 0; ; offset += 100) {
      const {data, totalCount} = await client.users.getUserList({limit:100, offset, orderBy:"+created_at"});
      for (const user of data) {
        const email = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId);
        rows.push([user.id, new Date(user.createdAt).toISOString(), email?.emailAddress,
          email?.verification?.status === "verified" ? "はい" : "いいえ",
          [user.firstName, user.lastName].filter(Boolean).join(" "), resolvePlan(user.privateMetadata).toUpperCase(),
          typeof user.privateMetadata.proExpiresAt === "string" ? user.privateMetadata.proExpiresAt : "",
          user.lastSignInAt ? new Date(user.lastSignInAt).toISOString() : ""]);
      }
      if (!data.length || offset + data.length >= totalCount) break;
    }
    return new Response(memberCsv(rows), {headers:{...headers,"Content-Type":"text/csv; charset=utf-8", "Content-Disposition":'attachment; filename="tech-phase-members.csv"'}});
  } catch { return new Response("Member export unavailable", {status:503,headers}); }
}
