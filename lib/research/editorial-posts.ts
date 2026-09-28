export type PostKind = "weekly" | "qa" | "notes";
export type EditorialPost = {
  id: string; version: number; kind: PostKind; status: "draft" | "published" | "withdrawn";
  translationStatus?: "ready" | "pending";
  titleJa: string; titleEn: string; introJa: string; introEn: string;
  bodyJa: string; bodyEn: string; sourceNotes?: string;
  sources: { title: string; url: string }[]; updatedAt: string; publishedAt: string | null;
};
export const postNames = {
  weekly: { ja: "週刊 Tech Phase PRO", en: "Tech Phase PRO Weekly" },
  qa: { ja: "リサーチQ&A", en: "Research Q&A" },
  notes: { ja: "リゼルのひとりごと", en: "RIZEL’s Notes" },
};
// Rebuild a strict public/member projection. Never spread the editor's payload.
export function publishedPosts(value: unknown, pro: boolean): EditorialPost[] {
  const raw = value as { ok?: unknown; items?: unknown } | null;
  if (raw?.ok !== true || !Array.isArray(raw.items)) throw new Error("invalid-posts");
  return raw.items.slice(0, 20).filter((item): item is EditorialPost => {
    if (!item || typeof item !== "object" || item.status !== "published" || !Object.hasOwn(postNames, item.kind)) return false;
    if (typeof item.id !== "string" || !/^[a-z0-9-]{16,64}$/.test(item.id) || !Number.isInteger(item.version)) return false;
    if (!["titleJa", "titleEn", "introJa", "introEn", "bodyJa", "bodyEn", "updatedAt", "publishedAt"].every(key => typeof item[key] === "string" && item[key].length <= 6000)) return false;
    return Number.isFinite(Date.parse(item.publishedAt)) && Array.isArray(item.sources) && item.sources.length <= 8;
  }).map(item => ({
    id: item.id, version: item.version, kind: item.kind, status: "published",
    titleJa: item.titleJa, titleEn: item.titleEn, introJa: item.introJa, introEn: item.introEn,
    translationStatus: item.kind === "notes" ? item.bodyEn.trim() ? "ready" : "pending" : item.titleEn.trim() && (!item.introJa.trim() || item.introEn.trim()) && item.bodyEn.trim() ? "ready" : "pending",
    bodyJa: pro ? item.bodyJa : "", bodyEn: pro ? item.bodyEn : "",
    updatedAt: item.updatedAt, publishedAt: item.publishedAt,
    sources: pro ? item.sources.filter(source => {
      if (!source || typeof source.title !== "string" || source.title.length > 180 || typeof source.url !== "string" || source.url.length > 1000) return false;
      try { const url = new URL(source.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    }).map(source => ({ title: source.title, url: source.url })) : [],
  }));
}
