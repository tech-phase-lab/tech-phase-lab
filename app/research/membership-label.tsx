"use client";
import { useMemberDisplay, useOwnerMode } from "./member-display-provider";
export default function MembershipLabel() {
  const plan = useMemberDisplay();
  const owner = useOwnerMode();
  return <small>{owner ? "RESEARCH · 運営者" : plan ? `RESEARCH · ${plan.toUpperCase()}` : "RESEARCH"}</small>;
}
