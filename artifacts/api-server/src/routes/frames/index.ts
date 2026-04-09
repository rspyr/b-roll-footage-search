import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, framesTable, videosTable } from "@workspace/db";

const router: IRouter = Router();

router.patch("/frames/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid frame ID" });
    return;
  }

  const { description } = req.body;
  if (typeof description !== "string") {
    res.status(400).json({ error: "description must be a string" });
    return;
  }

  const [existing] = await db.select().from(framesTable).where(eq(framesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Frame not found" });
    return;
  }

  const [updated] = await db
    .update(framesTable)
    .set({ description })
    .where(eq(framesTable.id, id))
    .returning();

  res.json(updated);
});

router.post("/videos/:id/frames", async (req, res): Promise<void> => {
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

  const { timestampSec, description } = req.body;
  if (typeof timestampSec !== "number" || timestampSec < 0) {
    res.status(400).json({ error: "timestampSec must be a non-negative number" });
    return;
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    res.status(400).json({ error: "description must be a non-empty string" });
    return;
  }

  const [inserted] = await db
    .insert(framesTable)
    .values({
      videoId,
      timestampSec,
      imagePath: `manual/${videoId}/${Date.now()}.txt`,
      description: description.trim(),
    })
    .returning();

  res.status(201).json(inserted);
});

export default router;
