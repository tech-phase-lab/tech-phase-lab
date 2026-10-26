import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { deskAudioFile, maxDeskAudioBytes, mp3Start, hasMp3Frames } from "./desk-audio";
export function audioStorage() {
  const account = process.env.DESK_MEDIA_R2_ACCOUNT_ID, bucket = process.env.DESK_MEDIA_R2_BUCKET;
  const accessKeyId = process.env.DESK_MEDIA_R2_ACCESS_KEY_ID, secretAccessKey = process.env.DESK_MEDIA_R2_SECRET_ACCESS_KEY;
  if (!account || !/^[a-f0-9]{32}$/.test(account) || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !accessKeyId || !secretAccessKey) throw Error("storage-not-configured");
  const client = new S3Client({ region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2 });
  return { client, bucket };
}
export async function beginAudioUpload(size: number) {
  const { client, bucket } = audioStorage();
  const file = `${randomUUID()}.mp3`;
  const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: `pending/${file}`, ContentType: "audio/mpeg", ContentLength: size }), { expiresIn: 900, signableHeaders: new Set(["content-type", "content-length"]) });
  return { file, uploadUrl };
}
export async function finishAudioUpload(file: string) {
  if (!deskAudioFile.test(file)) throw Error("invalid-mp3");
  const { client, bucket } = audioStorage(), key = `pending/${file}`;
  const options = { abortSignal: AbortSignal.timeout(15000) };
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), options);
  if (!head.ContentLength || head.ContentLength < 512 || head.ContentLength > maxDeskAudioBytes || head.ContentType !== "audio/mpeg" || !head.ETag) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options); throw Error("invalid-mp3");
  }
  async function prefix(start: number, length: number) {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${Math.min(head.ContentLength! - 1, start + length - 1)}`, IfMatch: head.ETag }), options);
    if (!response.Body || !response.ContentLength || response.ContentLength > length) { if (response.Body && "destroy" in response.Body) response.Body.destroy(); throw Error("invalid-mp3"); }
    return response.Body.transformToByteArray();
  }
  try {
    const start = mp3Start(await prefix(0, 10), head.ContentLength);
    if (!hasMp3Frames(await prefix(start, 16384))) throw Error("invalid-mp3");
  } catch (error) {
    if (error instanceof Error && error.message === "invalid-mp3") await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options);
    throw error;
  }
  // Copy a verified immutable object. Reusing the upload URL cannot replace it.
  await client.send(new CopyObjectCommand({ Bucket: bucket, Key: `audio/${file}`, CopySource: `${bucket}/${key}`, CopySourceIfMatch: head.ETag, MetadataDirective: "REPLACE", Metadata: { verified: "mp3" }, ContentType: "audio/mpeg", ContentDisposition: 'inline; filename="rizel-audio.mp3"', CacheControl: "private, max-age=0" }), options);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), options);
  return `/api/research/desk-media/${file}`;
}
export async function audioPlaybackUrl(file: string, accessExpiresAt: number) {
  if (!deskAudioFile.test(file)) throw Error("invalid-mp3");
  const { client, bucket } = audioStorage();
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `audio/${file}` }), { abortSignal: AbortSignal.timeout(10000) });
  if (head.Metadata?.verified !== "mp3" || head.ContentType !== "audio/mpeg") throw Error("invalid-mp3");
  const expiresIn = Math.min(3600, Math.floor((accessExpiresAt - Date.now()) / 1000));
  if (expiresIn < 1) throw Error("access-expired");
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: `audio/${file}`, ResponseContentType: "audio/mpeg", ResponseContentDisposition: 'inline; filename="rizel-audio.mp3"' }), { expiresIn });
}
