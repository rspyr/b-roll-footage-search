import { Router, type IRouter } from "express";
import { eq, sql, and, inArray } from "drizzle-orm";
import { db, videosTable, framesTable, transcriptionsTable } from "@workspace/db";
import { getFolderMetadata, listVideoFiles } from "../../lib/google-drive";
import { startProcessingQueue } from "../../lib/video-processor";
import { syncRateLimit } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import fs from "fs";
import path from "path";

const FRAMES_DIR = path.join(process.cwd(), "data", "frames");
const VIDEOS_DIR = path.join(process.cwd(), "data", "videos");

const router: IRouter = Router();

router.get("/folders", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      driveFolderId: videosTable.driveFolderId,
      videoCount: sql<number>`count(*)::int`,
      completedCount: sql<number>`count(*) filter (where ${videosTable.status} = 'completed')::int`,
      processingCount: sql<number>`count(*) filter (where ${videosTable.status} = 'processing')::int`,
      pendingCount: sql<number>`count(*) filter (where ${videosTable.status} = 'pending')::int`,
      failedCount: sql<number>`count(*) filter (where ${videosTable.status} = 'failed')::int`,
    })
    .from(videosTable)
    .groupBy(videosTable.driveFolderId);

  const folders = await Promise.all(
    rows
      .filter((r) => r.driveFolderId != null)
      .map(async (row) => {
        let folderName = row.driveFolderId!;
        try {
          const meta = await getFolderMetadata(row.driveFolderId!);
          folderName = meta.name;
        } catch {
          logger.warn({ folderId: row.driveFolderId }, "Could not fetch folder name from Drive");
        }

        return {
          driveFolderId: row.driveFolderId!,
          name: folderName,
          videoCount: row.videoCount,
          completedCount: row.completedCount,
          processingCount: row.processingCount,
          pendingCount: row.pendingCount,
          failedCount: row.failedCount,
        };
      }),
  );

  res.json(folders);
});

router.delete("/folders/:folderId", async (req, res): Promise<void> => {
  const folderId = req.params.folderId as string;

  const videos = await db
    .select({ id: videosTable.id, localPath: videosTable.localPath })
    .from(videosTable)
    .where(eq(videosTable.driveFolderId, folderId));

  if (videos.length === 0) {
    res.status(404).json({ error: "No videos found for this folder" });
    return;
  }

  const videoIds = videos.map((v) => v.id);

  await db.transaction(async (tx) => {
    await tx.delete(framesTable).where(inArray(framesTable.videoId, videoIds));
    await tx.delete(transcriptionsTable).where(inArray(transcriptionsTable.videoId, videoIds));
    await tx.delete(videosTable).where(eq(videosTable.driveFolderId, folderId));
  });

  for (const video of videos) {
    try {
      const framesDir = path.join(FRAMES_DIR, String(video.id));
      if (fs.existsSync(framesDir)) {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
      if (video.localPath && fs.existsSync(video.localPath)) {
        fs.unlinkSync(video.localPath);
      }
      const audioPath = path.join(VIDEOS_DIR, `${video.id}_audio.wav`);
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    } catch (err) {
      logger.warn({ videoId: video.id, err }, "Error cleaning up local files");
    }
  }

  res.json({ deletedCount: videos.length });
});

router.post("/folders/:folderId/sync", syncRateLimit, async (req, res): Promise<void> => {
  const folderId = req.params.folderId as string;

  const files = await listVideoFiles(folderId);
  const newVideos = [];

  for (const file of files) {
    const existing = await db
      .select()
      .from(videosTable)
      .where(eq(videosTable.driveFileId, file.id));

    if (existing.length === 0) {
      const [inserted] = await db
        .insert(videosTable)
        .values({
          title: file.name,
          driveFileId: file.id,
          driveFolderId: folderId,
          mimeType: file.mimeType,
          fileSize: file.size ? parseInt(file.size, 10) : null,
          status: "pending",
        })
        .returning();
      newVideos.push(inserted);
    }
  }

  if (newVideos.length > 0) {
    startProcessingQueue().catch((err) => {
      logger.error({ err, folderId }, "Background processing queue failed after folder re-sync");
    });
  }

  res.json({
    newVideoCount: newVideos.length,
    totalInDrive: files.length,
    videos: newVideos,
  });
});

export default router;
