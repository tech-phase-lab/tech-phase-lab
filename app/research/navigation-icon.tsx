export type NavigationIconName = "home" | "changes" | "search" | "companies" | "metrics" | "saved" | "pro" | "calendar" | "favorite" | "bell";
const paths: Record<NavigationIconName, string> = {
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  changes: "M3 12h4l3-7 4 14 3-7h4",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  companies: "M4 21V5h10v16M14 10h6v11M8 9h2M8 13h2M8 17h2M2 21h20",
  metrics: "M4 3v18h17M8 16v-5M13 16V6M18 16v-8",
  saved: "M6 3h12v18l-6-4-6 4V3Z",
  pro: "m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3 3-6Z",
  calendar: "M4 5h16v16H4V5ZM8 2v6M16 2v6M4 11h16M8 15h2M14 15h2",
  favorite: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z",
};
export default function NavigationIcon({ name }: { name: NavigationIconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
