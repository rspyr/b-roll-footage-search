import { db, videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { listVideoFiles } from "./google-drive";
import { startProcessingQueue } from "./video-processor";
import { logger } from "./logger";

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
let lastSyncTimestamp = 0;
let syncInProgress = false;

export async function syncAllFolders(): Promise<void> {
  const now = Date.now();
  if (now - lastSyncTimestamp < SYNC_COOLDOWN_MS) {
    logger.info({ lastSyncAgo: Math.round((now - lastSyncTimestamp) / 1000) }, "Skipping auto-sync, ran recently");
    return;
  }

  if (syncInProgress) {
    logger.info("Skipping auto-sync, already in progress");
    return;
  }

  syncInProgress = true;

  try {
    const rows = await db
      .selectDistinct({ driveFolderId: videosTable.driveFolderId })
      .from(videosTable);

    const folderIds = rows
      .map((r) => r.driveFolderId)
      .filter((id): id is string => id != null);

    if (folderIds.length === 0) {
      logger.info("Auto-sync: no folders to sync");
      return;
    }

    logger.info({ folderCount: folderIds.length }, "Auto-sync: checking folders for new files");

    let totalNew = 0;

    for (const folderId of folderIds) {
      try {
        const files = await listVideoFiles(folderId);

        for (const file of files) {
          const existing = await db
            .select()
            .from(videosTable)
            .where(eq(videosTable.driveFileId, file.id));

          if (existing.length === 0) {
            await db.insert(videosTable).values({
              title: file.name,
              driveFileId: file.id,
              driveFolderId: folderId,
              mimeType: file.mimeType,
              fileSize: file.size ? parseInt(file.size, 10) : null,
              status: "pending",
            });
            totalNew++;
          }
        }
      } catch (err) {
        logger.error({ err, folderId }, "Auto-sync: failed to sync folder");
      }
    }

    logger.info({ totalNew, folderCount: folderIds.length }, "Auto-sync: folder scan complete");

    if (totalNew > 0) {
      startProcessingQueue().catch((err) => {
        logger.error({ err }, "Auto-sync: background processing queue failed");
      });
    }

    lastSyncTimestamp = Date.now();
  } finally {
    syncInProgress = false;
  }
}
