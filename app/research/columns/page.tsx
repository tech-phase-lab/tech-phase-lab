import type { Metadata } from "next";
import ServerPosts from "./server-posts";
export const metadata: Metadata = { title: "RIZEL’S DESK | Tech Phase Research" };
export default function Page() { return <ServerPosts initialKind="all" />; }
