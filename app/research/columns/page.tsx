import ServerPosts from "./server-posts";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export default function Page() { return <ServerPosts initialKind="all" />; }
