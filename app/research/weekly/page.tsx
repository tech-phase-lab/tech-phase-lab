import ServerPosts from "../columns/server-posts";
export const metadata = { title: "週刊 Tech Phase PRO", robots: { index: false, follow: false } };
export default function Page() { return <ServerPosts initialKind="weekly" />; }
