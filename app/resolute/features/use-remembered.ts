"use client";
import { useState } from "react";
import { useReview } from "../review-context";
import { recall, type ViewMemoryKey } from "@/lib/resolute/view-memory";

/** What this tab last loaded for `key`, read once when the page opens, so the page can be drawn with it straight away
 * while it asks the server again. Never used in the owner preview, which has its own fictional data. */
export function useRemembered<T>(key: ViewMemoryKey): T | undefined {
 const review = useReview();
 const [value] = useState(() => review ? undefined : recall<T>(key));
 return value;
}
