"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { resoluteHtmlLang } from "@/lib/resolute/html-lang";

/** The page language for RESOLUTE (production QA, Nov 24: Japanese pages said <html lang="en">). The root layout is shared
 * with Tech Phase, so RESOLUTE sets it here: English for /resolute/lp/en and ?lang=en, otherwise Japanese. Screens with
 * a language switch (tool-shell.tsx) set it again for the language shown. */
export default function ResoluteHtmlLang() {
  const pathname = usePathname();
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = resoluteHtmlLang(pathname ?? "", window.location.search);
    return () => { document.documentElement.lang = previous; };
  }, [pathname]);
  return null;
}
