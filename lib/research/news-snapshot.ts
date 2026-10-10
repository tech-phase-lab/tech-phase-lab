import type { GeneralNewsFeed } from './general-news';
let feed: { data: GeneralNewsFeed; checkedAt: number } | null = null;
const listeners = new Set<() => void>();
export const newsSnapshot = () => feed;
export const serverNewsSnapshot = () => null;
export function subscribeNews(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishNews(value: GeneralNewsFeed | null) {
  // This shared snapshot feeds only the compact header. Unreviewed originals
  // stay in the news panel's own state and never enter the header data path;
  // test publications with a checked bilingual summary may.
  let data = value;
  if (value?.originalPreviewItems !== undefined || value?.originalPreviewWindow !== undefined) {
    data = { ...value }; delete data.originalPreviewItems; delete data.originalPreviewWindow;
    const summarized = (value.originalPreviewItems ?? []).filter(item => "summary" in item && !!item.summary);
    if (summarized.length) data.originalPreviewItems = summarized;
  }
  feed = data ? { data, checkedAt: Date.now() } : null;
  listeners.forEach(listener => listener());
}
