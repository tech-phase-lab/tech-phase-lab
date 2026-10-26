// Only MPEG Layer III files are accepted for direct uploads.
export const maxDeskAudioBytes = 50 * 1024 * 1024;
export const deskAudioFile = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.mp3$/;
export function validAudioUpload(name: unknown, size: unknown): size is number {
  return typeof name === "string" && name.length <= 255 && /\.mp3$/i.test(name) && typeof size === "number" && Number.isSafeInteger(size) && size >= 512 && size <= maxDeskAudioBytes;
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
