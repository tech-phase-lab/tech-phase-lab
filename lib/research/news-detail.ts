/** Reject empty/reformatted headline echoes without inventing replacement copy. */
export function additionalNewsDetail(visibleText: string | readonly string[], body?: string, sourceNames: string[] = []): string | undefined {
  const comparable = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/−/g, "-").replace(/[。.](?=\s|$)/g, "")
    .replace(/[^\p{L}\p{N}+\-.%$]+/gu, "");
  const text = typeof visibleText === "string" ? [visibleText] : visibleText;
  const visible = text.map(comparable);
  // Numeric metric labels must match a whole clause, not a substring of a
  // different population/basis such as youth versus overall unemployment.
  const clauses = text.flatMap(value => [value, ...[...value.matchAll(/[;；／\n]/g)].map(match => value.slice(match.index! + 1))]).map(comparable);
  const seen = new Set<string>();
  const paragraphs = (body ?? "").trim().split(/\n+/).map(text => text.trim()).map(text => {
    // Source identities stay in retained metadata, not the public story body.
    // Only strip a generated suffix made entirely of known source names.
    const factualText = text.replace(/[（(]([^()（）]+)[）)]\s*$/, (suffix, names: string) =>
      names.split(" / ").every(name => sourceNames.includes(name.trim())) ? "" : suffix);
    // A detail paragraph that opens by repeating the headline continues from
    // it instead: drop leading sentences the reader has already seen.
    const sentences = factualText.trim().split(/(?<=[。！？])|(?<=[a-z0-9]{2}[.!?])\s+(?=[A-Z])/);
    while (sentences.length > 1 && comparable(sentences[0]) && visible.some(value => value.includes(comparable(sentences[0])))) sentences.shift();
    return sentences.join(/[\u3040-\u30ff\u3400-\u9fff]/.test(factualText) ? "" : " ").trim();
  }).filter(text => {
    const key = comparable(text);
    const numericFact = /^.{1,80}[：:]\s*\$?[-+]?\d/.test(text);
    const alreadyVisible = numericFact ? clauses.some(clause => clause.startsWith(key)
      && (!/\d$/.test(key) || !/^[\d.BMK%]/i.test(clause.slice(key.length))))
      : visible.some(value => value.includes(key));
    if (!key || alreadyVisible || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return paragraphs.length ? paragraphs.join("\n\n") : undefined;
}
