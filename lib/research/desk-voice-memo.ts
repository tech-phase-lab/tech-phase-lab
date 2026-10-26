import { maxDeskAudioBytes } from "./desk-audio";
export const voiceMemoPrefix = "TECH_PHASE_VOICE_MEMO_V1:";
// Clipboard input is untrusted. Decode bounded chunks, never HTML or a URL.
export function voiceMemoFile(text: string): File {
  const maxEncoded = Math.ceil(maxDeskAudioBytes / 3) * 4;
  if (text.length > maxEncoded + voiceMemoPrefix.length + 16 || !text.startsWith(voiceMemoPrefix)) throw Error("invalid-voice-memo");
  const encoded = text.slice(voiceMemoPrefix.length).trim();
  if (encoded.length < 684 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error("invalid-voice-memo");
  const size = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (size < 512 || size > maxDeskAudioBytes) throw Error("invalid-voice-memo");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let at = 0; at < encoded.length; at += 32768) {
    const binary = atob(encoded.slice(at, at + 32768)), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    chunks.push(bytes);
  }
  // Voice Memos exports M4A. Full audio-only verification happens before R2 promotion.
  return new File(chunks, `voice-memo-${Date.now()}.m4a`, { type: "audio/mp4" });
}
