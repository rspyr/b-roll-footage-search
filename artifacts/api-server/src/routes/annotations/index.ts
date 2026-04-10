import { Router, type IRouter } from "express";
import { db, videoAnnotationsTable, videosTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { gemini } from "../../lib/gemini";
import { logger } from "../../lib/logger";
import { generateVideoTags } from "../../lib/video-processor";

const router: IRouter = Router();

router.post("/videos/:id/annotations", async (req, res): Promise<void> => {
  const videoId = parseInt(req.params.id);
  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const { content } = req.body;
  if (!content || typeof content !== "string" || !content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const userId = (req.session as any).userId as number;

  try {
    const video = await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
    if (video.length === 0) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    const [annotation] = await db.insert(videoAnnotationsTable).values({
      userId,
      videoId,
      content: content.trim(),
    }).returning();

    try {
      await generateVideoTags(videoId);
      logger.info({ videoId, annotationId: annotation.id }, "Regenerated tags after annotation");
    } catch (err) {
      logger.warn({ err, videoId }, "Failed to regenerate tags after annotation (non-fatal)");
    }

    res.status(201).json(annotation);
  } catch (err) {
    logger.error({ err, videoId }, "Failed to create annotation");
    res.status(500).json({ error: "Failed to create annotation" });
  }
});

router.get("/videos/:id/annotations", async (req, res): Promise<void> => {
  const videoId = parseInt(req.params.id);
  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const annotations = await db
    .select()
    .from(videoAnnotationsTable)
    .where(eq(videoAnnotationsTable.videoId, videoId))
    .orderBy(sql`${videoAnnotationsTable.createdAt} DESC`);

  res.json(annotations);
});

router.get("/annotations/status", async (req, res): Promise<void> => {
  const { videoIds } = req.query;
  if (!videoIds || typeof videoIds !== "string") {
    res.json({});
    return;
  }

  const ids = videoIds.split(",").map(Number).filter(n => !isNaN(n));
  if (ids.length === 0) {
    res.json({});
    return;
  }

  const results = await db
    .select({
      videoId: videoAnnotationsTable.videoId,
      count: sql<number>`count(*)::int`,
    })
    .from(videoAnnotationsTable)
    .where(inArray(videoAnnotationsTable.videoId, ids))
    .groupBy(videoAnnotationsTable.videoId);

  const statusMap: Record<number, number> = {};
  for (const r of results) {
    statusMap[r.videoId] = r.count;
  }

  res.json(statusMap);
});

export default router;
