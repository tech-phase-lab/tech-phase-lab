/** Incremental SSE framing; chunks can split UTF-8, lines, or whole events. */
export class EventStreamParser {
  private buffer = "";
  push(text: string): { event: string; data: string }[] {
    this.buffer += text;
    if (this.buffer.length > 200_000) throw new Error("Stream frame too large");
    const frames = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = frames.pop() ?? "";
    return frames.flatMap((frame) => {
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trimStart();
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      return data.length ? [{ event, data: data.join("\n") }] : [];
    });
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
