import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";
import fs from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

const connectors = new ReplitConnectors();

const VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
  "video/mpeg",
  "video/3gpp",
  "video/x-flv",
];

export interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
}

export async function listFolders(parentId?: string): Promise<DriveFolder[]> {
  let query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const allFolders: DriveFolder[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType)",
      orderBy: "name",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
      method: "GET",
    });

    const data = await response.json() as { files?: DriveFolder[]; nextPageToken?: string };
    allFolders.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFolders;
}

export async function listVideoFiles(folderId: string): Promise<DriveFile[]> {
  const mimeQuery = VIDEO_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");
  const query = `(${mimeQuery}) and '${folderId}' in parents and trashed=false`;

  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken,files(id,name,mimeType,size)",
      orderBy: "name",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
      method: "GET",
    });

    const data = await response.json() as { files?: DriveFile[]; nextPageToken?: string };
    allFiles.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

export async function getFolderMetadata(folderId: string): Promise<DriveFolder> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType",
    supportsAllDrives: "true",
  });

  const response = await connectors.proxy("google-drive", `/drive/v3/files/${folderId}?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error({ folderId, status: response.status, errorBody }, "Failed to get folder metadata from Google Drive");
    throw new Error(`Failed to get folder metadata: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as DriveFolder;
  return data;
}

export type DownloadProgressCallback = (bytesDownloaded: number, bytesTotal: number | null) => void;

export async function downloadFile(fileId: string, destPath: string, onProgress?: DownloadProgressCallback, signal?: AbortSignal): Promise<void> {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const params = new URLSearchParams({ alt: "media" });
  const response = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?${params.toString()}`, {
    method: "GET",
    signal: signal as any,
  });

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status} ${response.statusText}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error(`No response body for file ${fileId}`);
  }

  const contentLength = response.headers.get("content-length");
  const bytesTotal = contentLength ? parseInt(contentLength, 10) : null;

  const nodeStream = Readable.fromWeb(body as import("stream/web").ReadableStream);
  const writeStream = fs.createWriteStream(destPath);

  if (onProgress) {
    let bytesDownloaded = 0;
    const progressStream = new Transform({
      transform(chunk, _encoding, callback) {
        bytesDownloaded += chunk.length;
        onProgress(bytesDownloaded, bytesTotal);
        callback(null, chunk);
      },
    });
    await pipeline(nodeStream, progressStream, writeStream);
  } else {
    await pipeline(nodeStream, writeStream);
  }

  const stats = fs.statSync(destPath);
  logger.info({ fileId, destPath, size: stats.size }, "Downloaded file from Google Drive");
}
