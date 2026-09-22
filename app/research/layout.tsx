import type { ReactNode } from "react";
import BackToTop from "./back-to-top";

export default function ResearchLayout({ children }: { children: ReactNode }) {
  return <>{children}<BackToTop /></>;
}
