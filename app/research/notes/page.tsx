import type { Metadata } from "next";
import ServerPosts from "../columns/server-posts";
export const metadata: Metadata = { title: "リゼルのひとりごと | Tech Phase Research" };
export default function Page() { return <ServerPosts initialKind="notes" />; }
