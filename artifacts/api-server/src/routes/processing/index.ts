import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";
import { getProcessingState } from "../../lib/video-processor";

const router: IRouter = Router();

router.get("/processing-status", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-cache, no-store");
  res.removeHeader("ETag");
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'processing') as processing,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) as total
    FROM videos
  `);

  const row = result.rows[0];
  const processingState = getProcessingState();

  let pending = Number(row.pending);
  let processing = Number(row.processing);

  if (processingState.videoId) {
    const [activeVideo] = await db
      .select({ status: videosTable.status })
      .from(videosTable)
      .where(eq(videosTable.id, processingState.videoId));

    if (activeVideo && activeVideo.status === "pending") {
      pending = Math.max(0, pending - 1);
      processing = processing + 1;
    }
  }

  res.json({
    pending,
    processing,
    completed: Number(row.completed),
    failed: Number(row.failed),
    total: Number(row.total),
    currentVideo: processingState.videoId ? {
      id: processingState.videoId,
      title: processingState.videoTitle,
      step: processingState.step,
      startedAt: processingState.startedAt,
      stepStartedAt: processingState.stepStartedAt,
      current: processingState.current,
      total: processingState.total,
      bytesDownloaded: processingState.bytesDownloaded,
      bytesTotal: processingState.bytesTotal,
    } : null,
  });
});

export default router;
