import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transcriptionsTable, videosTable } from "@workspace/db";

const router: IRouter = Router();

router.patch("/transcriptions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid transcription ID" });
    return;
  }

  const { content } = req.body;
  if (typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "content must be a non-empty string" });
    return;
  }

  const [existing] = await db.select().from(transcriptionsTable).where(eq(transcriptionsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Transcription not found" });
    return;
  }

  const [updated] = await db
    .update(transcriptionsTable)
    .set({ content: content.trim() })
    .where(eq(transcriptionsTable.id, id))
    .returning();

  res.json(updated);
});

router.post("/videos/:id/transcriptions", async (req, res): Promise<void> => {
  const videoId = parseInt(req.params.id as string, 10);
  if (isNaN(videoId)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const { startSec, endSec, content } = req.body;
  if (typeof startSec !== "number" || startSec < 0) {
    res.status(400).json({ error: "startSec must be a non-negative number" });
    return;
  }
  if (typeof endSec !== "number" || endSec <= startSec) {
    res.status(400).json({ error: "endSec must be greater than startSec" });
    return;
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    res.status(400).json({ error: "content must be a non-empty string" });
    return;
  }

  const [inserted] = await db
    .insert(transcriptionsTable)
    .values({
      videoId,
      startSec,
      endSec,
      content: content.trim(),
    })
    .returning();

  res.status(201).json(inserted);
});

export default router;
