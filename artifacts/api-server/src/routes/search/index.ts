import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { SearchContentQueryParams } from "@workspace/api-zod";
import { searchRateLimit } from "../../lib/rate-limit";

const router: IRouter = Router();

router.get("/search", searchRateLimit, async (req, res): Promise<void> => {
  const params = SearchContentQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q, type = "all", limit = 20, offset = 0 } = params.data;

  const unionParts: string[] = [];

  if (type === "all" || type === "visual") {
    unionParts.push(`
      SELECT
        'frame' as type,
        f.video_id as "videoId",
        v.title as "videoTitle",
        f.timestamp_sec as "timestampSec",
        NULL::double precision as "endSec",
        f.description as content,
        f.image_path as "imagePath",
        ts_rank(to_tsvector('english', f.description), plainto_tsquery('english', $1)) as rank
      FROM frames f
      JOIN videos v ON v.id = f.video_id
      WHERE f.description IS NOT NULL
        AND to_tsvector('english', f.description) @@ plainto_tsquery('english', $1)
    `);
  }

  if (type === "all" || type === "audio") {
    unionParts.push(`
      SELECT
        'transcription' as type,
        t.video_id as "videoId",
        v.title as "videoTitle",
        t.start_sec as "timestampSec",
        t.end_sec as "endSec",
        t.content as content,
        NULL::text as "imagePath",
        ts_rank(to_tsvector('english', t.content), plainto_tsquery('english', $1)) as rank
      FROM transcriptions t
      JOIN videos v ON v.id = t.video_id
      WHERE to_tsvector('english', t.content) @@ plainto_tsquery('english', $1)
    `);
  }

  if (unionParts.length === 0) {
    res.json({ results: [], total: 0, query: q });
    return;
  }

  const unionQuery = unionParts.join(" UNION ALL ");
  const fullQuery = `
    SELECT * FROM (${unionQuery}) combined
    ORDER BY rank DESC
    LIMIT $2
    OFFSET $3
  `;
  const countQuery = `SELECT COUNT(*) as total FROM (${unionQuery}) combined`;

  const client = await pool.connect();
  try {
    const [dataResult, countResult] = await Promise.all([
      client.query(fullQuery, [q, limit, offset]),
      client.query(countQuery, [q]),
    ]);

    res.json({
      results: dataResult.rows.map((row: Record<string, unknown>) => ({
        type: String(row.type),
        videoId: Number(row.videoId),
        videoTitle: String(row.videoTitle),
        timestampSec: Number(row.timestampSec),
        endSec: row.endSec != null ? Number(row.endSec) : null,
        content: String(row.content),
        imagePath: row.imagePath ? String(row.imagePath) : null,
        rank: Number(row.rank),
      })),
      total: Number(countResult.rows[0].total),
      query: q,
    });
  } finally {
    client.release();
  }
});

export default router;
