"use client";
import Link from "next/link";
import { createContext, useContext, type ComponentProps } from "react";
import { requestPlan } from "@/lib/resolute/plan-client";
import { requestNotificationSettings } from "@/lib/resolute/notification-client";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
export const reviewPaths = ["/resolute", "/resolute/simulation", "/resolute/alerts", "/resolute/morning", "/resolute/thermometer", "/resolute/tax", "/resolute/notebook"] as const;
export type ReviewPath = typeof reviewPaths[number];
export type ReviewWorkspace = {
 path: ReviewPath; navigate: (path: ReviewPath) => void;
 locale: DiagnosisLocale; setLocale: (locale: DiagnosisLocale) => void;
 requestPlan: typeof requestPlan; requestNotificationSettings: typeof requestNotificationSettings;
};
export const ReviewContext = createContext<ReviewWorkspace | null>(null);
export const useReview = () => useContext(ReviewContext);
export function usePlanClient() { return useReview()?.requestPlan ?? requestPlan; }
export function useNotificationClient() { return useReview()?.requestNotificationSettings ?? requestNotificationSettings; }
// Review navigation is an in-page action. It must never invoke Next routing or Clerk's hash router.
export function ReviewLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>,"onClick"> & {onClick?:()=>void}) {
 const review = useReview();
 const internal = typeof href === "string" && reviewPaths.includes(href as ReviewPath);
 if (!review || !internal) return <Link {...props} href={href} onClick={onClick}/>;
 return <button type="button" className={props.className} aria-current={props["aria-current"]}
  aria-label={props["aria-label"]} onClick={()=>{onClick?.();review.navigate(href as ReviewPath);}}>{props.children}</button>;
}
