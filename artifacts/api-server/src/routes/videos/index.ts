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
import { processVideo, startProcessingQueue, requestCancellation, getProcessingState, invalidateQueue, generateVideoTags } from "../../lib/video-processor";
import { syncRateLimit, processRateLimit } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";

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

router.post("/videos/:id/cancel", processRateLimit, async (req, res): Promise<void> => {
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

  if (video.status !== "pending" && video.status !== "processing") {
    res.status(400).json({ error: `Cannot cancel video with status "${video.status}"` });
    return;
  }

  const processingState = getProcessingState();
  const isActivelyProcessing = video.status === "processing" && processingState.videoId === params.data.id;

  await db.update(videosTable)
    .set({ status: "cancelled" })
    .where(eq(videosTable.id, params.data.id));

  if (isActivelyProcessing) {
    requestCancellation(params.data.id);
    invalidateQueue();
    startProcessingQueue().catch(err => {
      req.log.error({ err }, "Failed to restart processing queue after cancel");
    });
  }

  res.json({
    message: "Video cancelled",
    videoId: params.data.id,
    status: "cancelled",
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

router.patch("/videos/:id/tags", async (req, res): Promise<void> => {
  const videoId = parseInt(req.params.id);
  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const { tags } = req.body;
  if (typeof tags !== "string") {
    res.status(400).json({ error: "tags is required and must be a string" });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const normalizedTags = tags
    .split(",")
    .map((t: string) => t.trim().toLowerCase())
    .filter(Boolean)
    .join(", ");

  await db.update(videosTable).set({ tags: normalizedTags }).where(eq(videosTable.id, videoId));
  res.json({ success: true });
});

let backfillInProgress = false;

router.post("/videos/backfill-tags", async (_req, res): Promise<void> => {
  if (backfillInProgress) {
    res.status(409).json({ error: "Tag backfill is already in progress" });
    return;
  }

  const allCompleted = await db.select({
    id: videosTable.id,
    title: videosTable.title,
    tags: videosTable.tags,
  }).from(videosTable)
    .where(eq(videosTable.status, "completed"));

  const videosNeedingTags = allCompleted.filter(v => !v.tags);

  backfillInProgress = true;
  res.json({ message: `Starting backfill for ${videosNeedingTags.length} videos`, total: videosNeedingTags.length });

  (async () => {
    let succeeded = 0;
    let failed = 0;

    try {
      for (const video of videosNeedingTags) {
        try {
          const frames = await db.select({ description: framesTable.description })
            .from(framesTable)
            .where(eq(framesTable.videoId, video.id));

          const transcriptions = await db.select({ content: transcriptionsTable.content })
            .from(transcriptionsTable)
            .where(eq(transcriptionsTable.videoId, video.id));

          const tags = await generateVideoTags(
            video.title,
            frames.map(f => f.description).filter(Boolean) as string[],
            transcriptions.map(t => t.content).filter(Boolean) as string[],
          );

          await db.update(videosTable).set({ tags }).where(eq(videosTable.id, video.id));
          succeeded++;
          logger.info({ videoId: video.id, tags }, "Backfilled tags");
        } catch (err) {
          failed++;
          logger.error({ videoId: video.id, err }, "Failed to backfill tags");
        }
      }
    } finally {
      backfillInProgress = false;
    }

    logger.info({ succeeded, failed, total: videosNeedingTags.length }, "Tag backfill complete");
  })();
});

export default router;
