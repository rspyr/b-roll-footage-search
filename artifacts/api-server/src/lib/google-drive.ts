import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";
import fs from "fs";
import path from "path";

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

  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType)",
    orderBy: "name",
    pageSize: "100",
  });

  const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
    method: "GET",
  });

  const data = await response.json() as { files?: DriveFolder[] };
  return data.files || [];
}

export async function listVideoFiles(folderId: string): Promise<DriveFile[]> {
  const mimeQuery = VIDEO_MIME_TYPES.map(m => `mimeType='${m}'`).join(" or ");
  const query = `(${mimeQuery}) and '${folderId}' in parents and trashed=false`;

  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,mimeType,size)",
    orderBy: "name",
    pageSize: "100",
  });

  const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
    method: "GET",
  });

  const data = await response.json() as { files?: DriveFile[] };
  return data.files || [];
}

export async function downloadFile(fileId: string, destPath: string): Promise<void> {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const params = new URLSearchParams({ alt: "media" });
  const response = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?${params.toString()}`, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(destPath, buffer);
  logger.info({ fileId, destPath, size: buffer.length }, "Downloaded file from Google Drive");
}
