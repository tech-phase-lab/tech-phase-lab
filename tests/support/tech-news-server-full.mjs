// Test stand-in for lib/research/tech-news-server.ts (which needs Clerk): the viewer has full (PRO) access.
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export const viewerHasFullNews = async () => true;
export const readMonitor = async () => { throw new Error("not used for full access"); };
