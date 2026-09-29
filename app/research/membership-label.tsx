"use client";
import { useMemberDisplay } from "./member-display-provider";
export default function MembershipLabel() {
  const plan = useMemberDisplay();
  return <small>{plan ? `RESEARCH · ${plan.toUpperCase()}` : "RESEARCH"}</small>;
}
