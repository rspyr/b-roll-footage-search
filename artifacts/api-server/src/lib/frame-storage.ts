import { Storage } from "@google-cloud/storage";
import fs from "fs";
import { Readable } from "stream";
import { logger } from "./logger";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function getBucketAndPrefix(): { bucketName: string; prefix: string } {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  }
  return { bucketName: bucketId, prefix: "frames" };
}

export async function uploadFrame(
  localPath: string,
  imagePath: string,
): Promise<void> {
  const { bucketName, prefix } = getBucketAndPrefix();
  const objectName = `${prefix}/${imagePath}`;
  const bucket = gcsClient.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(fs.readFileSync(localPath), {
    contentType: "image/jpeg",
    metadata: { cacheControl: "public, max-age=86400" },
  });
}

export async function streamFrame(
  imagePath: string,
): Promise<{ stream: Readable; contentType: string } | null> {
  const { bucketName, prefix } = getBucketAndPrefix();
  const objectName = `${prefix}/${imagePath}`;
  const bucket = gcsClient.bucket(bucketName);
  const file = bucket.file(objectName);

  try {
    const [exists] = await file.exists();
    if (!exists) return null;

    const stream = file.createReadStream();
    return { stream, contentType: "image/jpeg" };
  } catch (err) {
    logger.error({ err, imagePath }, "Failed to stream frame from object storage");
    return null;
  }
}

export async function deleteVideoFrames(videoId: number): Promise<void> {
  const { bucketName, prefix } = getBucketAndPrefix();
  const bucket = gcsClient.bucket(bucketName);
  const folderPrefix = `${prefix}/${videoId}/`;

  try {
    await bucket.deleteFiles({ prefix: folderPrefix });
  } catch (err) {
    logger.warn({ err, videoId }, "Failed to delete frames from object storage");
  }
}
