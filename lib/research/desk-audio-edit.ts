export type AudioSpan = readonly [number, number];
export const frameCount = (spans: readonly AudioSpan[]) => spans.reduce((sum, [a, b]) => sum + b - a, 0);
// Coordinates refer to the current edited timeline, but spans retain original PCM indices.
export function cutAudioSpans(spans: readonly AudioSpan[], from: number, to: number): AudioSpan[] {
  const total = frameCount(spans);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to > total || to <= from || to - from >= total) throw Error("invalid-cut");
  let offset = 0; const result: AudioSpan[] = [];
  for (const [a, b] of spans) {
    const end = offset + b - a;
    const left = Math.max(offset, Math.min(end, from)), right = Math.max(offset, Math.min(end, to));
    if (left > offset) result.push([a, a + left - offset]);
    if (right < end) result.push([a + right - offset, b]);
    offset = end;
  }
  return result;
}
export function audioSamples(channel: Float32Array, spans: readonly AudioSpan[], from: number, count: number) {
  const out = new Float32Array(count); let at = 0, written = 0;
  for (const [a, b] of spans) {
    const n = b - a, start = Math.max(0, from - at), end = Math.min(n, from + count - at);
    if (end > start) { out.set(channel.subarray(a + start, a + end), written); written += end - start; }
    at += n; if (written >= count) break;
  }
  return out;
}
export async function exportEditedAudio(buffer: AudioBuffer, spans: readonly AudioSpan[], signal: AbortSignal, progress: (percent: number) => void) {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") throw Error("encoding-unsupported");
  const config: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels, bitrate: 128000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) throw Error("encoding-unsupported");
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: "aac", numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let failure: Error | null = null;
  const encoder = new AudioEncoder({ output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata), error: error => { failure = error; } });
  const abort = () => { if (encoder.state !== "closed") encoder.close(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted(); encoder.configure(config);
    const total = frameCount(spans);
    for (let at = 0; at < total; at += 4096) {
      signal.throwIfAborted(); if (failure) throw failure;
      const n = Math.min(4096, total - at), pcm = new Float32Array(n * buffer.numberOfChannels);
      for (let c = 0; c < buffer.numberOfChannels; c++) pcm.set(audioSamples(buffer.getChannelData(c), spans, at, n), c * n);
      const data = new AudioData({ format: "f32-planar", sampleRate: buffer.sampleRate, numberOfFrames: n, numberOfChannels: buffer.numberOfChannels, timestamp: Math.round(at / buffer.sampleRate * 1000000), data: pcm });
      try { encoder.encode(data); } finally { data.close(); }
      if (encoder.encodeQueueSize > 8) {
        const deadline = Date.now() + 30000;
        do { signal.throwIfAborted(); if (failure) throw failure; if (Date.now() > deadline) throw Error("encoder-timeout"); await new Promise(resolve => setTimeout(resolve, 5)); } while (encoder.encodeQueueSize > 8);
        progress(Math.round((at + n) / total * 100));
      }
    }
    await encoder.flush(); signal.throwIfAborted(); if (failure) throw failure;
    muxer.finalize();
    return new File([muxer.target.buffer], `rizel-edited-${Date.now()}.m4a`, { type: "audio/mp4" });
  } finally { signal.removeEventListener("abort", abort); if (encoder.state !== "closed") encoder.close(); }
}
