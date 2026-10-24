export function targetPreview(title: string, tickers: string[]) {
  const normalized = title.replace(/,/g, "");
  const match = normalized.match(/price target (?:raised|lowered|cut|hiked) to \$(\d+(?:\.\d+)?) from \$(\d+(?:\.\d+)?)/i);
  const firm = normalized.match(/(?:at|by) (BofA|BNP Paribas|Citi|Citizens|KeyBanc|Stifel|UBS|JPMorgan|Seaport Research)\b/i);
  if (!match || !firm || tickers.length !== 1) return null;
  const latest = Number(match[1]);
  const previous = Number(match[2]);
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || latest === previous) return null;
  return {
    heading: `${tickers[0]}：${firm[1]}が目標株価を${previous.toLocaleString("en-US")}ドルから${latest.toLocaleString("en-US")}ドルへ${latest > previous ? "引き上げ" : "引き下げ"}`,
    summary: `${firm[1]}による${tickers[0]}の目標株価変更がXに投稿されました。数値と格付けは原発表での確認待ちです。`,
  };
}
