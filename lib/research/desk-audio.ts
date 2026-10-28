// Direct uploads are limited to MP3 and audio-only M4A.
export const maxDeskAudioBytes = 50 * 1024 * 1024;
export const deskAudioFile = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(?:mp3|m4a)$/;
export function validAudioUpload(name: unknown, size: unknown): size is number {
  return typeof name === "string" && name.length <= 255 && /\.(?:mp3|m4a)$/i.test(name) && typeof size === "number" && Number.isSafeInteger(size) && size >= 512 && size <= maxDeskAudioBytes;
}
export function mp3Start(bytes: Uint8Array, total: number) {
  if (bytes[0] !== 73 || bytes[1] !== 68 || bytes[2] !== 51) return 0;
  if (bytes.length < 10 || ![2, 3, 4].includes(bytes[3]) || bytes.slice(6, 10).some(v => v > 127)) throw Error("invalid-mp3");
  const size = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9] + (bytes[3] === 4 && (bytes[5] & 16) ? 10 : 0);
  if (size + 8 >= total) throw Error("invalid-mp3");
  return size;
}
function frameLength(bytes: Uint8Array, i: number) {
  if (i + 4 > bytes.length || bytes[i] !== 255 || (bytes[i + 1] & 224) !== 224 || ((bytes[i + 1] >> 1) & 3) !== 1) return 0;
  const version = (bytes[i + 1] >> 3) & 3, rate = (bytes[i + 2] >> 4) & 15, sample = (bytes[i + 2] >> 2) & 3;
  if (version === 1 || !rate || rate === 15 || sample === 3) return 0;
  const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[rate];
  const frequency = [44100,48000,32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  return Math.floor((version === 3 ? 144000 : 72000) * bitrate / frequency) + ((bytes[i + 2] >> 1) & 1);
}
export function hasMp3Frames(bytes: Uint8Array) {
  // Two consecutive Layer III headers, not merely an ID3 tag or .mp3 filename.
  for (let i = 0; i < Math.min(bytes.length - 4, 4096); i++) {
    const length = frameLength(bytes, i);
    if (length && frameLength(bytes, i + length)) return true;
  }
  return false;
}

export function audioFormat(name: string) {
  const extension = /\.m4a$/i.test(name) ? "m4a" : "mp3";
  return { extension, contentType: extension === "m4a" ? "audio/mp4" : "audio/mpeg" };
}
// Inspect bounded ISO BMFF metadata without downloading the audio payload.
// Every track must be audio; a renamed MP4 containing a video track is rejected.
export async function verifyM4a(total: number, read: (offset: number, length: number) => Promise<Uint8Array>) {
  const bad = () => { throw Error("invalid-audio"); };
  const word = (b: Uint8Array, i: number) => { if (i + 4 > b.length) return bad(); return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i); };
  const tag = (b: Uint8Array, i: number) => String.fromCharCode(...b.slice(i, i + 4));
  function header(b: Uint8Array, remaining: number) {
    if (b.length < 8) return bad();
    let size = word(b, 0); const type = tag(b, 4), head = size === 1 ? 16 : 8;
    if (size === 1) size = word(b, 8) * 4294967296 + word(b, 12);
    else if (size === 0) size = remaining;
    if (!Number.isSafeInteger(size) || size < head || size > remaining) return bad();
    return { size, type, head };
  }
  function boxes(b: Uint8Array) {
    const result: { type: string; data: Uint8Array }[] = [];
    for (let at = 0; at < b.length;) {
      if (result.length >= 256) return bad();
      const h = header(b.subarray(at, at + 16), b.length - at);
      result.push({ type: h.type, data: b.subarray(at + h.head, at + h.size) }); at += h.size;
    }
    return result;
  }
  const one = (b: Uint8Array, type: string) => {
    const matches = boxes(b).filter(box => box.type === type);
    if (matches.length !== 1) return bad(); return matches[0].data;
  };
  let ftyp = false, moov = false, mdat = false, count = 0, fragmented = false;
  const trackIds = new Set<number>();
  let cacheStart = -1, cache: Uint8Array = new Uint8Array(0), metadataBytes = 0;
  async function metadata(offset: number, length: number) {
    if (!fragmented) return read(offset, length);
    // Browser recordings can contain hundreds of tiny fragments. Batch nearby
    // range reads so a ten-minute recording does not require thousands of RTTs.
    if (offset < cacheStart || offset + length > cacheStart + cache.length) {
      cacheStart = offset;
      cache = await read(offset, Math.min(total - offset, Math.max(length, 1024 * 1024)));
    }
    return cache.subarray(offset - cacheStart, offset - cacheStart + length);
  }
  for (let at = 0; at < total;) {
    if (++count > 2048) return bad();
    const h = header(await metadata(at, Math.min(16, total - at)), total - at);
    if (h.type === "ftyp") {
      if (ftyp || h.size > 1024 || h.size - h.head < 8) return bad();
      const b = await metadata(at + h.head, h.size - h.head);
      const brands = [tag(b, 0)]; for (let i = 8; i + 4 <= b.length; i += 4) brands.push(tag(b, i));
      if (!brands.some(v => ["M4A ", "isom", "iso2", "mp41", "mp42", "qt  "].includes(v))) return bad();
      ftyp = true;
    } else if (h.type === "moov") {
      if (moov || h.size > 2 * 1024 * 1024) return bad();
      const b = await metadata(at + h.head, h.size - h.head), children = boxes(b);
      const tracks = children.filter(v => v.type === "trak");
      if (!tracks.length || tracks.length > 8) return bad();
      fragmented = children.some(v => v.type === "mvex");
      for (const track of tracks) {
        if (fragmented) {
          const tkhd = one(track.data, "tkhd");
          if (![0, 1].includes(tkhd[0])) return bad();
          const id = word(tkhd, tkhd[0] === 1 ? 20 : 12);
          if (!id || trackIds.has(id)) return bad(); trackIds.add(id);
        }
        const media = one(track.data, "mdia"), handler = one(media, "hdlr");
        if (handler.length < 12 || tag(handler, 8) !== "soun") return bad();
        const descriptions = one(one(one(media, "minf"), "stbl"), "stsd");
        if (descriptions.length < 8 || word(descriptions, 0) !== 0) return bad();
        const samples = boxes(descriptions.subarray(8));
        if (!samples.length || samples.length !== word(descriptions, 4) || samples.some(v => !["mp4a", "alac"].includes(v.type) || v.data.length < 28)) return bad();
      }
      if (fragmented) {
        const defaults = boxes(one(b, "mvex")).filter(v => v.type === "trex");
        const seen = new Set<number>();
        for (const entry of defaults) {
          if (entry.data.length !== 24 || word(entry.data, 0) !== 0) return bad();
          const id = word(entry.data, 4);
          if (!trackIds.has(id) || seen.has(id) || word(entry.data, 8) !== 1) return bad(); seen.add(id);
        }
        if (seen.size !== trackIds.size) return bad();
      }
      moov = true;
    } else if (h.type === "mdat") { if (h.size > h.head) mdat = true; }
    else if (h.type === "moof") {
      metadataBytes += h.size;
      if (!moov || !fragmented || h.size > 256 * 1024 || metadataBytes > 4 * 1024 * 1024) return bad();
      const fragments = boxes(await metadata(at + h.head, h.size - h.head)).filter(v => v.type === "traf");
      if (!fragments.length || fragments.length > 8) return bad();
      for (const fragment of fragments) {
        const tfhd = one(fragment.data, "tfhd");
        if (tfhd.length < 8 || tfhd[0] !== 0 || !trackIds.has(word(tfhd, 4))) return bad();
        // Only the first, already verified audio sample description may be used.
        const flags = word(tfhd, 0) & 0xffffff;
        if ((flags & 2) && word(tfhd, 8 + ((flags & 1) ? 8 : 0)) !== 1) return bad();
      }
    }
    at += h.size;
  }
  if (!ftyp || !moov || !mdat) return bad();
}
