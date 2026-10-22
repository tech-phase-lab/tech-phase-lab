import type { Metadata } from "next";
import ServerPosts from "../../columns/server-posts";

// This page is built per request; only the research home is prerendered (owner, Oct 22: faster app open).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "リゼルに聞く｜公開回答 | Tech Phase Research" };
export default function Page() { return <ServerPosts initialKind="qa" />; }
