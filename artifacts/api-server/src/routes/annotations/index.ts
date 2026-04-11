import { Router, type IRouter } from "express";
import { db, videoAnnotationsTable, videosTable, framesTable, transcriptionsTable, videoSegmentsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { generateVideoTags } from "../../lib/video-processor";
import { gemini } from "../../lib/gemini";

const router: IRouter = Router();

async function regenerateTagsForVideo(videoId: number): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
  if (!video) return;

  const frames = await db
    .select({ description: framesTable.description })
    .from(framesTable)
    .where(eq(framesTable.videoId, videoId));

  const transcriptions = await db
    .select({ content: transcriptionsTable.content })
    .from(transcriptionsTable)
    .where(eq(transcriptionsTable.videoId, videoId));

  const annotations = await db
    .select({ content: videoAnnotationsTable.content })
    .from(videoAnnotationsTable)
    .where(eq(videoAnnotationsTable.videoId, videoId));

  const frameDescriptions = frames
    .map(f => f.description)
    .filter((d): d is string => d !== null && d !== undefined);

  const transcriptionTexts = transcriptions.map(t => t.content);
  const annotationTexts = annotations.map(a => a.content);
  const allTexts = [...transcriptionTexts, ...annotationTexts];

  const tags = await generateVideoTags(video.title, frameDescriptions, allTexts);
  await db.update(videosTable).set({ tags }).where(eq(videosTable.id, videoId));
}

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

  const userId = req.session.userId;

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
      await regenerateTagsForVideo(videoId);
      logger.info({ videoId, annotationId: annotation.id }, "Regenerated tags after annotation");
    } catch (err) {
      logger.warn({ err, videoId }, "Failed to regenerate tags after annotation (non-fatal)");
    }

    try {
      const allAnnotations = await db
        .select({ content: videoAnnotationsTable.content })
        .from(videoAnnotationsTable)
        .where(eq(videoAnnotationsTable.videoId, videoId));
      const combinedText = allAnnotations.map(a => a.content).join(". ");

      const embedResult = await gemini.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: combinedText,
        config: { outputDimensionality: 768 },
      });
      const embedding = embedResult.embeddings?.[0]?.values;
      if (embedding) {
        const [v] = await db.select({ duration: videosTable.duration }).from(videosTable).where(eq(videosTable.id, videoId)).limit(1);
        const dur = v?.duration ?? 0;

        await db.delete(videoSegmentsTable).where(
          sql`${videoSegmentsTable.videoId} = ${videoId} AND ${videoSegmentsTable.startSec} = -1`
        );
        await db.insert(videoSegmentsTable).values({
          videoId,
          startSec: -1,
          endSec: dur,
          embedding,
        });
        logger.info({ videoId }, "Embedded annotation text for vector search");
      }
    } catch (err) {
      logger.warn({ err, videoId }, "Failed to embed annotation text (non-fatal)");
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

  try {
    const annotations = await db
      .select()
      .from(videoAnnotationsTable)
      .where(eq(videoAnnotationsTable.videoId, videoId))
      .orderBy(sql`${videoAnnotationsTable.createdAt} DESC`);

    res.json(annotations);
  } catch (err) {
    logger.error({ err, videoId }, "Failed to fetch annotations");
    res.status(500).json({ error: "Failed to fetch annotations" });
  }
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

  try {
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
  } catch (err) {
    logger.error({ err }, "Failed to fetch annotation status");
    res.status(500).json({ error: "Failed to fetch annotation status" });
  }
});

export default router;
