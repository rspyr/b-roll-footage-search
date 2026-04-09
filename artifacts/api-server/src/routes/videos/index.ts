import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, videosTable, framesTable, transcriptionsTable } from "@workspace/db";
import {
  ListVideosQueryParams,
  GetVideoParams,
  ProcessVideoParams,
  SyncVideosBody,
} from "@workspace/api-zod";
import { listVideoFiles } from "../../lib/google-drive";
import { processVideo, startProcessingQueue } from "../../lib/video-processor";
import { syncRateLimit, processRateLimit } from "../../lib/rate-limit";

const router: IRouter = Router();

router.get("/videos", async (req, res): Promise<void> => {
  const params = ListVideosQueryParams.safeParse(req.query);

  if (params.success && params.data.status) {
    const videos = await db.select().from(videosTable)
      .where(eq(videosTable.status, params.data.status))
      .orderBy(videosTable.createdAt);
    res.json(videos);
    return;
  }

  const videos = await db.select().from(videosTable).orderBy(videosTable.createdAt);
  res.json(videos);
});

router.get("/videos/:id", async (req, res): Promise<void> => {
  const params = GetVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, params.data.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const frames = await db.select().from(framesTable)
    .where(eq(framesTable.videoId, params.data.id))
    .orderBy(framesTable.timestampSec);

  const transcriptions = await db.select().from(transcriptionsTable)
    .where(eq(transcriptionsTable.videoId, params.data.id))
    .orderBy(transcriptionsTable.startSec);

  res.json({
    ...video,
    frames,
    transcriptions,
  });
});

router.post("/videos/:id/process", processRateLimit, async (req, res): Promise<void> => {
  const params = ProcessVideoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, params.data.id));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  await db.update(videosTable)
    .set({ status: "pending" })
    .where(eq(videosTable.id, params.data.id));

  startProcessingQueue().catch(err => {
    req.log.error({ err, videoId: params.data.id }, "Background processing queue failed");
  });

  res.json({
    message: "Video queued for processing",
    videoId: params.data.id,
    status: "pending",
  });
});

router.post("/videos/sync", syncRateLimit, async (req, res): Promise<void> => {
  const parsed = SyncVideosBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const files = await listVideoFiles(parsed.data.folderId);
  const syncedVideos = [];

  for (const file of files) {
    const existing = await db.select().from(videosTable)
      .where(eq(videosTable.driveFileId, file.id));

    if (existing.length === 0) {
      const [inserted] = await db.insert(videosTable).values({
        title: file.name,
        driveFileId: file.id,
        driveFolderId: parsed.data.folderId,
        mimeType: file.mimeType,
        fileSize: file.size ? parseInt(file.size, 10) : null,
        status: "pending",
      }).returning();
      syncedVideos.push(inserted);
    } else {
      syncedVideos.push(existing[0]);
    }
  }

  startProcessingQueue().catch(err => {
    req.log.error({ err }, "Background processing queue failed after sync");
  });

  res.json({
    syncedCount: syncedVideos.length,
    videos: syncedVideos,
  });
});

export default router;
