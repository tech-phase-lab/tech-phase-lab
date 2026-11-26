import type { Issue } from "./issues";

// Kept out of issues.tsx ("use client"): the server page calls ownerState() for the owner's first paint, and a function
// exported from a client module cannot be called on the server (production error on /research/weekly, Nov 26).
export type OwnerState = { drafts: Issue[]; autoPublish: boolean; generateEnabled: boolean; generateHour: number; lastGenerated: string | null; generation: { running: boolean; configured: boolean; lastOk: boolean | null; lastError: string } };
/** The owner's view (drafts, settings, generation state) from the route's answer; null when the answer is not one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The monitor's answer, checked field by field.
export function ownerState(data: any): OwnerState | null {
  if (!data || !Array.isArray(data.drafts) || !data.settings) return null;
  return { drafts: data.drafts, autoPublish: data.settings.autoPublish === true, generateEnabled: data.settings.generateEnabled === true, generateHour: data.settings.generateHour ?? 8, lastGenerated: data.settings.lastGenerated ?? null, generation: data.generation ?? { running: false, configured: false, lastOk: null, lastError: "" } };
}
