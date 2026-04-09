import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, framesTable, transcriptionsTable, videosTable } from "@workspace/db";
import { SearchContentQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/search", async (req, res): Promise<void> => {
  const params = SearchContentQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q, type = "all", limit = 20, offset = 0 } = params.data;

  const tsQuery = q.trim().split(/\s+/).join(" & ");
  const results: Array<{
    type: "frame" | "transcription";
    videoId: number;
    videoTitle: string;
    timestampSec: number;
    endSec: number | null;
    content: string;
    imagePath: string | null;
    rank: number;
  }> = [];

  if (type === "all" || type === "visual") {
    const frameResults = await db.execute(sql`
      SELECT
        f.id,
        f.video_id as "videoId",
        v.title as "videoTitle",
        f.timestamp_sec as "timestampSec",
        f.image_path as "imagePath",
        f.description as "content",
        ts_rank(to_tsvector('english', f.description), plainto_tsquery('english', ${q})) as rank
      FROM frames f
      JOIN videos v ON v.id = f.video_id
      WHERE f.description IS NOT NULL
        AND to_tsvector('english', f.description) @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    for (const row of frameResults.rows) {
      results.push({
        type: "frame",
        videoId: Number(row.videoId),
        videoTitle: String(row.videoTitle),
        timestampSec: Number(row.timestampSec),
        endSec: null,
        content: String(row.content),
        imagePath: row.imagePath ? String(row.imagePath) : null,
        rank: Number(row.rank),
      });
    }
  }

  if (type === "all" || type === "audio") {
    const transcriptionResults = await db.execute(sql`
      SELECT
        t.id,
        t.video_id as "videoId",
        v.title as "videoTitle",
        t.start_sec as "timestampSec",
        t.end_sec as "endSec",
        t.content as "content",
        ts_rank(to_tsvector('english', t.content), plainto_tsquery('english', ${q})) as rank
      FROM transcriptions t
      JOIN videos v ON v.id = t.video_id
      WHERE to_tsvector('english', t.content) @@ plainto_tsquery('english', ${q})
      ORDER BY rank DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    for (const row of transcriptionResults.rows) {
      results.push({
        type: "transcription",
        videoId: Number(row.videoId),
        videoTitle: String(row.videoTitle),
        timestampSec: Number(row.timestampSec),
        endSec: row.endSec ? Number(row.endSec) : null,
        content: String(row.content),
        imagePath: null,
        rank: Number(row.rank),
      });
    }
  }

  results.sort((a, b) => b.rank - a.rank);

  res.json({
    results: results.slice(0, limit),
    total: results.length,
    query: q,
  });
});

export default router;
