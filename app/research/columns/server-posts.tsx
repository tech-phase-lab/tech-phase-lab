import "server-only";
import { GET } from "../../api/research/posts/route";
import ColumnsPage from "./columns";
import type { PostKind } from "@/lib/research/editorial-posts";
export default async function ServerPosts({ initialKind = "all" }: { initialKind?: PostKind | "all" }) {
  const response = await GET();
  const data = await response.json();
  // eslint-disable-next-line react-hooks/purity -- Request-time validation of the server-issued access lease.
  const initial = response.ok && data.ok && Array.isArray(data.items) && Number.isFinite(data.validUntil) && data.validUntil > Date.now() ? { items: data.items, access: data.access, status: "ready", validUntil: data.validUntil } : undefined;
  return <ColumnsPage initialKind={initialKind} initial={initial} />;
}
