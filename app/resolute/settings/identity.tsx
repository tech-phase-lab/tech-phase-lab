"use client";
import { useAuth } from "@clerk/nextjs";
import SettingsScreen from "./screen";

export default function AuthenticatedSettings() {
  const { isLoaded, sessionId } = useAuth();
  // A different session gets a fresh form; never carry one account's settings into another.
  return <SettingsScreen key={sessionId ?? "signed-out"} identityReady={isLoaded} />;
}
