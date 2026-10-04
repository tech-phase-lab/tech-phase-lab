import type { GeneralNewsFeed } from './general-news';
let feed: { data: GeneralNewsFeed; checkedAt: number } | null = null;
const listeners = new Set<() => void>();
export const newsSnapshot = () => feed;
export const serverNewsSnapshot = () => null;
export function subscribeNews(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function publishNews(value: GeneralNewsFeed | null) { feed = value ? { data: value, checkedAt: Date.now() } : null; listeners.forEach(listener => listener()); }
