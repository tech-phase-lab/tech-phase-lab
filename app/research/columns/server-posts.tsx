import "server-only";
import { GET } from "../../api/research/posts/route";
import { GET as reactionsGET } from "../../api/research/desk-reactions/route";
import ColumnsPage from "./columns";
import { preloadReactions } from "../desk/reaction-state";
import type { EditorialPost, PostKind } from "@/lib/research/editorial-posts";
export default async function ServerPosts({ initialKind = "all" }: { initialKind?: PostKind | "all" }) {
  const response = await GET();
  const data = await response.json();
  // eslint-disable-next-line react-hooks/purity -- Request-time validation of the server-issued access lease.
  const valid = response.ok && data.ok && Array.isArray(data.items) && Number.isFinite(data.validUntil) && data.validUntil > Date.now();
  // A PRO reader's notes come with their reaction counts, so each badge is in the first paint instead of popping in one by one and
  // pushing the notes below it down (owner, Nov 18). Same relay and membership check as the browser's request; capped in time.
  const reactions = valid && data.access === "pro" ? await preloadReactions((data.items as EditorialPost[]).filter(item => item.kind === "notes").map(item => item.id),
    async id => (await reactionsGET(new Request(`https://tech-phase.internal/api/research/desk-reactions?postId=${encodeURIComponent(id)}`))).json()) : undefined;
  const initial = valid ? { items: data.items, access: data.access, status: "ready", validUntil: data.validUntil, reactions } : undefined;
  return <ColumnsPage initialKind={initialKind} initial={initial} />;
}
