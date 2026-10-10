import type { Metadata } from "next";
import ServerPosts from "../../columns/server-posts";
export const metadata: Metadata = { title: "リゼルに聞く｜公開回答 | Tech Phase Research" };
export default function Page() { return <ServerPosts initialKind="qa" />; }
