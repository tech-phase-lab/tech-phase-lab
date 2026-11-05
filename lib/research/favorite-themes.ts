/** "気になるテーマ" (owner, Nov 5): the themes a new member picks in the first question, and can change later in Account. */
export const THEMES = [
  { id: "ai-semis", ja: "AI半導体", en: "AI chips" },
  { id: "data-center", ja: "データセンター", en: "Data centers" },
  { id: "optical", ja: "光通信", en: "Optical networking" },
  { id: "memory", ja: "メモリ", en: "Memory" },
  { id: "network", ja: "ネットワーク", en: "Networking" },
  { id: "power-cooling", ja: "電力・冷却", en: "Power & cooling" },
  { id: "software", ja: "ソフトウェア", en: "Software" },
  { id: "quantum", ja: "量子コンピュータ", en: "Quantum computing" },
  { id: "robotics", ja: "ロボット", en: "Robotics" },
  { id: "space", ja: "宇宙", en: "Space" },
] as const;
export const THEME_IDS: readonly string[] = THEMES.map(theme => theme.id);

/** Saved with the account: `asked` is true once the question has been shown and answered or skipped ("あとで", "まだ決めていない"). */
export type FavoriteThemes = { asked: boolean; items: string[] };

export function toggleTheme(selected: readonly string[], id: string) {
  if (!THEME_IDS.includes(id)) return [...selected];
  return selected.includes(id) ? selected.filter(value => value !== id) : THEME_IDS.filter(value => value === id || selected.includes(value));
}

/** What the server stored, or "not asked yet". Anything unexpected counts as not asked, never as a guess. */
export function readFavoriteThemes(value: unknown): FavoriteThemes {
  const v = value as { asked?: unknown; items?: unknown } | null;
  if (!v || v.asked !== true || !Array.isArray(v.items)) return { asked: false, items: [] };
  return { asked: true, items: THEME_IDS.filter(id => (v.items as unknown[]).includes(id)) };
}
