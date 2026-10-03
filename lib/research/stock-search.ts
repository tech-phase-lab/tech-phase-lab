// Explicit issuer aliases; unknown Japanese names must not become broad ASCII searches.
const japaneseNames: Record<string, string[]> = {
  MU: ["マイクロン", "マイクロンテクノロジー"],
  SKHY: ["SKハイニックス", "エスケーハイニックス"],
  SNDK: ["サンディスク"], NBIS: ["ネビウス"],
  NVDA: ["エヌビディア", "エヌヴィディア", "エヌビディアコーポレーション"],
  AMD: ["エーエムディー", "アドバンストマイクロデバイセズ"],
  AVGO: ["ブロードコム"], ARM: ["アーム"],
  TSM: ["ティーエスエムシー", "台湾積体電路製造"], ASML: ["エーエスエムエル"],
  MRVL: ["マーベル", "マーベルテクノロジー"],
  ANET: ["アリスタ", "アリスタネットワークス"], CRDO: ["クレド"],
  CRWV: ["コアウィーブ"], VRT: ["バーティブ", "ヴァーティブ"],
  GEV: ["GEベルノバ", "GEヴェルノバ", "ジーイーベルノバ"],
  DELL: ["デル", "デルテクノロジーズ"], PLTR: ["パランティア"],
  MSFT: ["マイクロソフト"], BE: ["ブルームエナジー"],
  GOOGL: ["アルファベット", "グーグル"], ORCL: ["オラクル"],
};

function normalizedSearch(value: string) {
  return value.normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .toLocaleUpperCase("en-US")
    .replace(/[^\p{L}\p{N}.-]+/gu, " ").trim();
}

export function searchStocks<T extends { ticker: string; name: string; tracked?: boolean }>(entries: T[], query: string, limit = 24): T[] {
  const q = normalizedSearch(query).slice(0, 80);
  if (!q) return [];
  const terms = q.split(/\s+/);
  return entries.flatMap(entry => {
    const ticker = normalizedSearch(entry.ticker);
    const name = normalizedSearch(entry.name);
    const aliases = (japaneseNames[entry.ticker] ?? []).map(normalizedSearch);
    const fields = [ticker, name, ...aliases];
    if (!terms.every(term => fields.some(field => field.includes(term)))) return [];
    const score = ticker === q ? 0 : aliases.includes(q) ? 5 : ticker.startsWith(q) ? 10 : name.startsWith(q) || aliases.some(alias => alias.startsWith(q)) ? 20 : name.includes(q) || aliases.some(alias => alias.includes(q)) ? 30 : ticker.includes(q) ? 40 : 50;
    return [{ entry, score }];
  }).toSorted((a, b) => a.score - b.score || Number(Boolean(b.entry.tracked)) - Number(Boolean(a.entry.tracked)) || a.entry.ticker.localeCompare(b.entry.ticker))
    .slice(0, Math.min(Math.max(1, limit), 40)).map(({ entry }) => entry);
}
