"use client";
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

/** True inside a PRO feature tour sample: a stock row stays in the sample instead of opening the stock page (owner, Nov 22). */
export const StaysInSample = createContext(false);

/** A stock row of a PRO tool: a link to the stock page, or, inside a sample, a plain block marked data-pro-only, which the sample
 * frame answers with its small 「PROで使えます」 (a Next link would navigate on its own before the frame could stop it). */
export default function StockRowLink({ href, className, title, children, ...aria }: {
  href: string; className?: string; title?: string; children: ReactNode; "aria-label"?: string;
}) {
  const still = useContext(StaysInSample);
  return still
    ? <div className={className} title={title} data-pro-only="" role="group" {...aria}>{children}</div>
    : <Link href={href} className={className} title={title} {...aria}>{children}</Link>;
}
