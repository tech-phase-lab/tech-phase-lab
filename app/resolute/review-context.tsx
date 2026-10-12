"use client";
import Link from "next/link";
import { createContext, useContext, type ComponentProps } from "react";
import { requestPlan } from "@/lib/resolute/plan-client";
import { requestNotificationSettings } from "@/lib/resolute/notification-client";
import type { DiagnosisLocale } from "@/lib/resolute/diagnosis-copy";
export const reviewPaths = ["/resolute", "/resolute/simulation", "/resolute/alerts", "/resolute/morning", "/resolute/thermometer", "/resolute/tax"] as const;
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
export function ReviewLink({ href, onClick, ...props }: ComponentProps<typeof Link>) {
 const review = useReview();
 const internal = typeof href === "string" && reviewPaths.includes(href as ReviewPath);
 if (!review || !internal) return <Link {...props} href={href} onClick={onClick}/>;
 return <Link {...props} href={`/resolute/review#${href === "/resolute" ? "diagnosis" : String(href).split("/").pop()}`} onClick={event => {
  onClick?.(event);
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault(); review.navigate(href as ReviewPath);
 }}/>;
}
