import providers from "./providers.json" with { type: "json" };
import seeds from "../../scripts/research/sources.json" with { type: "json" };

export type NoticeSourceClass = "issuer-metadata" | "exchange-disclosure" | "official-document" | "seeded-document";
const documents: Record<string, string> = {
  "https://docs.nebius.com/compute/virtual-machines/preemptible": "Nebius · Preemptible VMs",
  "https://docs.nebius.com/changelog": "Nebius · Product changelog",
};

/** Exact per-source exceptions; never a general query or document-root allowance. */
export function configuredNoticeIdentity(value: string): { key: string; sourceClass: NoticeSourceClass; sourceName: string; sourcePublishedOn?: string } | null {
  try {
    const url = new URL(value);
    if (value !== url.href || value.length > 4096 || url.protocol !== "https:" || url.username || url.password || url.port || url.hash || value.includes("#")
      || /[\x00-\x20\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)) return null;
    const seed = seeds.find(row => row.ticker === "NBIS" && row.url === value && url.hostname === "assets.nebius.com" && /\.pdf$/i.test(url.pathname));
    if (seed && providers.find(provider => provider.ticker === "NBIS")?.allowedHosts.includes("assets.nebius.com")) return { key: value, sourceClass: "seeded-document", sourceName: "Nebius · PDF", sourcePublishedOn: seed.publishedOn };
    if (documents[value]) return { key: `${url.hostname}${url.pathname}`, sourceClass: "official-document", sourceName: documents[value] };
    for (const provider of providers) {
      for (const source of provider.fallbackSources ?? []) {
        if (!("twseCompanyCode" in source) || source.format !== "twse-material-json" || value.split("?")[0] !== source.url || !provider.allowedHosts.includes(url.hostname)) continue;
        const q = url.searchParams;
        const company = q.get("company"), date = q.get("date") ?? "", time = q.get("time") ?? "", id = q.get("id") ?? "";
        if (company !== source.twseCompanyCode || [...q.keys()].join(",") !== "company,date,time,id"
          || !/^\d{7}$/.test(date) || !/^\d{1,6}$/.test(time) || !/^[a-f0-9]{16}$/.test(id)
          || url.search !== `?company=${company}&date=${date}&time=${time}&id=${id}`
          || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time.padStart(6, "0"))) return null;
        const on = `${Number(date.slice(0, 3)) + 1911}-${date.slice(3, 5)}-${date.slice(5, 7)}`;
        if (!Number.isFinite(Date.parse(on)) || new Date(on).toISOString().slice(0, 10) !== on) return null;
        return { key: value, sourceClass: "exchange-disclosure", sourceName: `TWSE · ${provider.name}`, sourcePublishedOn: on };
      }
      if (!url.search && value === `${url.origin}${url.pathname}` && !["www.sec.gov", "data.sec.gov"].includes(url.hostname)
        && !/\/(?:careers?|jobs?|webinars?|events?|authors?|tags?|categories|category|feed|pricing)(?:\/|$)/i.test(url.pathname)
        && provider.articleRules.some(rule => url.hostname === rule.host && new RegExp(rule.pattern).test(url.pathname))) {
        return { key: `${url.hostname}${url.pathname.replace(/\/$/, "")}`, sourceClass: "issuer-metadata", sourceName: provider.name };
      }
    }
  } catch { /* Malformed and unconfigured sources are not metadata notices. */ }
  return null;
}
