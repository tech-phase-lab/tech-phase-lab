import { loadMacro } from "@/lib/research/macro";

export async function GET() {
  const items = await loadMacro();
  return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" } });
}
