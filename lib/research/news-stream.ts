import { EventStreamParser, abortableDelay } from "./event-stream.ts";

/**
 * One shared push connection per tab. The server sends only a news revision;
 * each change wakes the existing pollers, which fetch /api/research/news through
 * the same validated path as before. While the push connection is healthy the
 * pollers slow down to a safety interval; if it drops they return to normal
 * polling and the connection retries in the background.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let controller: AbortController | null = null;
let live = false;

export function isNewsStreamLive() {
  return live;
}

export function subscribeNewsChanges(listener: Listener): () => void {
  listeners.add(listener);
  if (!controller && typeof window !== "undefined" && typeof fetch === "function") {
    controller = new AbortController();
    void run(controller.signal);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && controller) {
      controller.abort();
      controller = null;
      live = false;
    }
  };
}

function notify() {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* One panel cannot stop the others. */ }
  }
}

async function run(signal: AbortSignal) {
  let failures = 0;
  let revision: string | null = null;
  while (!signal.aborted) {
    const connection = new AbortController();
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let expiresAt = 0;
    try {
      const response = await fetch("/api/research/news/stream", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
      if (!response.ok) throw new Error("Stream unavailable");
      const config = await response.json();
      if (!config.ok || typeof config.ticket !== "string" || typeof config.url !== "string") throw new Error("Invalid connection");
      expiresAt = config.expiresAt * 1000;
      watchdog = setTimeout(() => connection.abort(), 15_000);
      const stream = await fetch(config.url, { headers: { Authorization: `Bearer ${config.ticket}` },
        signal: AbortSignal.any([signal, connection.signal]), credentials: "omit", cache: "no-store" });
      if (!stream.ok || !stream.body || !stream.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Stream unavailable");
      reader = stream.body.getReader();
      const decoder = new TextDecoder();
      const parser = new EventStreamParser();
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done || signal.aborted) break;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => connection.abort(), 45_000);
        for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
          if (event.event === "unavailable") throw new Error("Feed unavailable");
          if (event.event !== "snapshot") continue;
          const items = JSON.parse(event.data)?.items;
          const next = Array.isArray(items) && typeof items[0] === "string" ? items[0] : null;
          if (!next) continue;
          live = true;
          failures = 0;
          // The first revision after (re)connecting also refreshes once, in
          // case a change happened while disconnected.
          if (next !== revision) {
            revision = next;
            notify();
          }
        }
      }
      if (Date.now() < expiresAt - 2000) throw new Error("Stream disconnected");
    } catch {
      live = false;
      if (signal.aborted) break;
      failures += 1;
      await abortableDelay(Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4)) + Math.random() * 1000, signal).catch(() => {});
    } finally {
      clearTimeout(watchdog);
      connection.abort();
      await reader?.cancel().catch(() => {});
    }
  }
  live = false;
}
