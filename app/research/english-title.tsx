"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useResearchLanguage } from "./use-research-language";
import { englishTitle } from "@/lib/research/english-titles";

/** In the English view the browser tab says so too. The page's own (Japanese) title is put back when the language is switched back. */
const originals = new Map<string, string>();
export default function EnglishTitle() {
  const [lang] = useResearchLanguage();
  const pathname = usePathname();
  useEffect(() => {
    const path = pathname ?? "";
    const wanted = englishTitle(path);
    if (lang !== "en") { const own = originals.get(path); if (own && document.title === wanted) document.title = own; return; }
    if (!wanted) return;
    if (!originals.has(path) && document.title !== wanted) originals.set(path, document.title);
    const apply = () => { if (document.title !== wanted) document.title = wanted; };
    apply();
    // Next.js writes the page's title after navigation; keep the English one until the language or page changes.
    const node = document.querySelector("title");
    const observer = node ? new MutationObserver(apply) : null;
    if (node) observer?.observe(node, { childList: true, characterData: true, subtree: true });
    return () => observer?.disconnect();
  }, [lang, pathname]);
  return null;
}
