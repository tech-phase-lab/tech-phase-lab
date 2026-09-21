type Evidence = { id: string; section: "business" | "risk"; quote: string };

export function referencedQuotes(evidence: Evidence[], ids: string[]) {
  return ids.map(id => evidence.find(item => item.id === id)?.quote ?? "").filter(Boolean);
}

export function businessDraftEvidence(summaryQuotes: string[], modelQuotes: string[]) {
  const evidence: Evidence[] = [];
  const byQuote = new Map<string, string>();
  function references(quotes: string[]) {
    if (quotes.length < 1 || quotes.length > 8) throw new Error("各項目の事業根拠は1〜8件にしてください。");
    return [...new Set(quotes.map(value => {
      const quote = value.trim();
      if (quote.length < 24 || quote.length > 800) throw new Error("根拠引用は1件24〜800文字にしてください。");
      let id = byQuote.get(quote);
      if (!id) {
        id = `business-${evidence.length + 1}`;
        byQuote.set(quote, id);
        evidence.push({ id, section: "business", quote });
      }
      return id;
    }))];
  }
  const summaryEvidenceIds = references(summaryQuotes);
  const businessModelEvidenceIds = references(modelQuotes);
  return { evidence, summaryEvidenceIds, businessModelEvidenceIds };
}
