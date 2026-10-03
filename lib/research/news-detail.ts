/** Reject empty/reformatted headline echoes without inventing replacement copy. */
export function additionalNewsDetail(title: string, body?: string, sourceNames: string[] = []): string | undefined {
  const comparable = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/−/g, "-").replace(/[。.](?=\s|$)/g, "")
    .replace(/[^\p{L}\p{N}+\-.%$]+/gu, "");
  const headline = comparable(title);
  const seen = new Set<string>();
  const paragraphs = (body ?? "").trim().split(/\n+/).map(text => text.trim()).map(text => {
    // Source identities stay in retained metadata, not the public story body.
    // Only strip a generated suffix made entirely of known source names.
    const factualText = text.replace(/[（(]([^()（）]+)[）)]\s*$/, (suffix, names: string) =>
      names.split(" / ").every(name => sourceNames.includes(name.trim())) ? "" : suffix);
    return factualText.trim();
  }).filter(text => {
    const key = comparable(text);
    if (!key || headline.includes(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return paragraphs.length ? paragraphs.join("\n\n") : undefined;
}
