import config from "./pro-experience.json" with { type: "json" };

/** PRO機能体験 (owner, Nov 5): eight features (Tech Alerts is shown as a text-only difference below the list), each with a video, an image and text that the owner replaces in
 * pro-experience.json. A video or image left empty is not drawn; the text alone is shown. */
export type ProFeature = {
  id: string; name: { ja: string; en: string }; summary: { ja: string; en: string };
  thumbnailUrl: string; videoUrl: string; videoLabel: string; imageUrl: string; imageCaption: { ja: string; en: string };
  textBeforeImage: { ja: string; en: string }; textAfterImage: { ja: string; en: string };
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
/** A media address must be a path on this site or an https address; anything else is treated as not set. */
export function mediaUrl(value: unknown) {
  const url = text(value);
  if (!url) return "";
  if (/^\/(?!\/)[^\s]*$/.test(url)) return url;
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : ""; } catch { return ""; }
}
const pair = (ja: unknown, en: unknown) => ({ ja: text(ja), en: text(en) });

export function readFeatures(value: unknown): ProFeature[] {
  const list = (value as { features?: unknown } | null)?.features;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.flatMap((raw): ProFeature[] => {
    const v = raw as Record<string, unknown>;
    const id = text(v?.id);
    if (!/^[a-z0-9-]{2,40}$/.test(id) || seen.has(id) || !text(v.nameJa)) return [];
    seen.add(id);
    return [{ id, name: pair(v.nameJa, v.nameEn), summary: pair(v.summaryJa, v.summaryEn), thumbnailUrl: mediaUrl(v.thumbnailUrl), videoUrl: mediaUrl(v.videoUrl),
      videoLabel: text(v.videoLabel), imageUrl: mediaUrl(v.imageUrl), imageCaption: pair(v.imageCaptionJa, v.imageCaptionEn),
      textBeforeImage: pair(v.textBeforeImageJa, v.textBeforeImageEn), textAfterImage: pair(v.textAfterImageJa, v.textAfterImageEn) }];
  });
}
export const proFeatures: ProFeature[] = readFeatures(config);

/** English text is not written yet; the Japanese is shown until it is. */
export const inLanguage = (value: { ja: string; en: string }, lang: "ja" | "en") => lang === "en" && value.en ? value.en : value.ja;
export const featureById = (id: string) => proFeatures.find(feature => feature.id === id);
/** The next feature in the list; after the last, the first. */
export function nextFeature(id: string, list: readonly ProFeature[] = proFeatures) {
  const index = list.findIndex(feature => feature.id === id);
  return index < 0 || list.length < 2 ? undefined : list[(index + 1) % list.length];
}
