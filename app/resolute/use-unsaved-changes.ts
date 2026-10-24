"use client";
import { useEffect } from "react";

// Native refresh/close protection only. No answers are copied to browser storage.
// Browsers control the dialog text and may require prior user interaction.
export function useUnsavedChanges(dirty: boolean) {
 useEffect(() => {
  if (!dirty) return;
  const protect = (event: BeforeUnloadEvent) => {
   event.preventDefault();
   event.returnValue = "";
  };
  window.addEventListener("beforeunload", protect);
  return () => window.removeEventListener("beforeunload", protect);
 }, [dirty]);
}
