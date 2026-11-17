"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { priceTargetSample, withoutSampleQuery } from "@/lib/research/price-target-sample";
import type { PriceTarget } from "@/lib/research/price-targets";

/** Reads ?demo=nvda (the owner's filming notice, lib/research/price-target-sample.ts) on the price-target page: hands the sample row
 * to the page, then removes the query from the address bar so a reload shows the normal page. Renders nothing; the page wraps it in
 * Suspense (useSearchParams). */
export default function PriceTargetSampleQuery({ onSample }: { onSample: (item: PriceTarget) => void }) {
  const params = useSearchParams();
  const sample = params?.get("demo") ?? null;
  useEffect(() => {
    const item = priceTargetSample(sample === null ? null : { get: name => name === "demo" ? sample : null }, Date.now());
    if (!item) return;
    onSample(item);
    const clean = withoutSampleQuery(window.location.href);
    if (clean !== null) window.history.replaceState(null, "", clean);
  }, [sample, onSample]);
  return null;
}
