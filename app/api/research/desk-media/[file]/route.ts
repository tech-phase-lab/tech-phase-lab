import { getMembership } from "@/lib/membership/server";
import { audioPlaybackUrl } from "@/lib/research/desk-audio-storage";
import { deskAudioFile } from "@/lib/research/desk-audio";
import { GET as getPosts } from "../../posts/route";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const denied = (status: number) => new Response(null, { status, headers });
export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await context.params;
    if (!deskAudioFile.test(file)) return denied(404);
    const member = await getMembership();
    if (member.status !== "signed-in") return denied(401);
    if (!member.isAdmin && (member.plan !== "pro" || !(member.accessExpiresAt > Date.now()))) return denied(403);
    if (!member.isAdmin) {
      const post = new URL(request.url).searchParams.get("post");
      if (!post || !/^[a-z0-9-]{16,64}$/.test(post)) return denied(404);
      const response = await getPosts(new Request(`${new URL(request.url).origin}/api/research/posts?id=${encodeURIComponent(post)}`));
      const data = await response.json();
      const attachment = `[audio](/api/research/desk-media/${file})`;
      if (!response.ok || !data.ok || data.access !== "pro" || !Array.isArray(data.items) || !data.items.some((item: { id: string; kind: string; status: string; bodyJa: string; bodyEn: string }) => item.id === post && item.kind === "notes" && item.status === "published" && [item.bodyJa, item.bodyEn].some(body => body.split("\n").some(line => line.trim() === attachment)))) return denied(404);
    }
    const expiresIn = member.isAdmin ? 3600 : Math.min(3600, Math.floor((member.accessExpiresAt - Date.now()) / 1000));
    if (expiresIn < 1) return denied(403);
    const location = await audioPlaybackUrl(file, member.isAdmin ? Date.now() + 3600000 : member.accessExpiresAt);
    if (!member.isAdmin && member.accessExpiresAt <= Date.now()) return denied(403);
    return new Response(null, { status: 307, headers: { ...headers, Location: location } });
  } catch { return denied(503); }
}
