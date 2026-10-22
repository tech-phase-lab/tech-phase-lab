import ServerPosts from "../columns/server-posts";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata = { title: "週刊 Tech Phase PRO", robots: { index: false, follow: false } };
export default function Page() { return <ServerPosts initialKind="weekly" />; }
