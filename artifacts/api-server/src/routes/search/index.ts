import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { SearchContentQueryParams } from "@workspace/api-zod";
import { searchRateLimit } from "../../lib/rate-limit";
import { gemini } from "../../lib/gemini";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

async function embedQuery(query: string): Promise<number[] | null> {
  try {
    const result = await gemini.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: query,
      config: {
        outputDimensionality: 768,
      },
    });

    return result.embeddings?.[0]?.values ?? null;
  } catch (err) {
    logger.error({ err, query }, "Failed to embed search query");
    return null;
  }
}

router.get("/search", searchRateLimit, async (req, res): Promise<void> => {
  const params = SearchContentQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { q, type = "all", limit = 20, offset = 0 } = params.data;

  const fetchLimit = (limit + offset) * 5 + 50;

  const queryEmbedding = await embedQuery(q);

  const ftsUnionParts: string[] = [];

  if (type === "all" || type === "visual") {
    ftsUnionParts.push(`
      SELECT
        'frame' as type,
        f.video_id as "videoId",
        v.title as "videoTitle",
        v.drive_file_id as "driveFileId",
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
    ftsUnionParts.push(`
      SELECT
        'transcription' as type,
        t.video_id as "videoId",
        v.title as "videoTitle",
        v.drive_file_id as "driveFileId",
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

  const client = await pool.connect();
  try {
    const allResults: Array<{
      type: string;
      videoId: number;
      videoTitle: string;
      driveFileId: string | null;
      timestampSec: number;
      endSec: number | null;
      content: string;
      imagePath: string | null;
      rank: number;
      source: string;
    }> = [];

    if (queryEmbedding && (type === "all" || type === "visual")) {
      const vectorQuery = `
        SELECT
          'segment' as type,
          vs.video_id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          vs.start_sec as "timestampSec",
          vs.end_sec as "endSec",
          '' as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = vs.video_id ORDER BY ABS(f.timestamp_sec - vs.start_sec) LIMIT 1) as "imagePath",
          1 - (vs.embedding <=> $1::vector) as similarity
        FROM video_segments vs
        JOIN videos v ON v.id = vs.video_id
        WHERE vs.embedding IS NOT NULL
        ORDER BY vs.embedding <=> $1::vector
        LIMIT $2
      `;

      const embeddingStr = `[${queryEmbedding.join(",")}]`;
      const vectorResult = await client.query(vectorQuery, [embeddingStr, fetchLimit]);

      for (let i = 0; i < vectorResult.rows.length; i++) {
        const row = vectorResult.rows[i];
        const rrfScore = 1 / (60 + i + 1);
        allResults.push({
          type: String(row.type),
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: Number(row.timestampSec),
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: row.content ? String(row.content) : `Semantic match (similarity: ${Number(row.similarity).toFixed(3)})`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "vector",
        });
      }
    }

    if (ftsUnionParts.length > 0) {
      const ftsUnion = ftsUnionParts.join(" UNION ALL ");
      const ftsQuery = `
        SELECT * FROM (${ftsUnion}) combined
        ORDER BY rank DESC
        LIMIT $2
      `;

      const ftsResult = await client.query(ftsQuery, [q, fetchLimit]);

      for (let i = 0; i < ftsResult.rows.length; i++) {
        const row = ftsResult.rows[i];
        const rrfScore = 1 / (60 + i + 1);
        allResults.push({
          type: String(row.type),
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: Number(row.timestampSec),
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: String(row.content),
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "fts",
        });
      }
    }

    const titleQuery = `
      SELECT
        'title' as type,
        v.id as "videoId",
        v.title as "videoTitle",
        v.drive_file_id as "driveFileId",
        0 as "timestampSec",
        v.duration::double precision as "endSec",
        v.title as content,
        (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
        ts_rank(to_tsvector('english', v.title), plainto_tsquery('english', $1)) as rank
      FROM videos v
      WHERE to_tsvector('english', v.title) @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT $2
    `;

    const titleResult = await client.query(titleQuery, [q, fetchLimit]);
    const TITLE_BOOST = 3;

    for (let i = 0; i < titleResult.rows.length; i++) {
      const row = titleResult.rows[i];
      const rrfScore = (1 / (60 + i + 1)) * TITLE_BOOST;
      allResults.push({
        type: String(row.type),
        videoId: Number(row.videoId),
        videoTitle: String(row.videoTitle),
        driveFileId: row.driveFileId ? String(row.driveFileId) : null,
        timestampSec: Number(row.timestampSec),
        endSec: row.endSec != null ? Number(row.endSec) : null,
        content: `Title match: ${String(row.content)}`,
        imagePath: row.imagePath ? String(row.imagePath) : null,
        rank: rrfScore,
        source: "title",
      });
    }

    allResults.sort((a, b) => b.rank - a.rank);

    const mergedMap = new Map<number, typeof allResults[0]>();
    for (const result of allResults) {
      const existing = mergedMap.get(result.videoId);
      if (existing) {
        existing.rank += result.rank;
      } else {
        mergedMap.set(result.videoId, { ...result });
      }
    }

    const allMerged = Array.from(mergedMap.values())
      .sort((a, b) => b.rank - a.rank);

    const total = allMerged.length;
    const paged = allMerged.slice(offset, offset + limit);

    const videoIds = [...new Set(paged.map(r => r.videoId))];
    const framePathsMap = new Map<number, string[]>();
    if (videoIds.length > 0) {
      const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(",");
      const framesResult = await client.query(
        `SELECT video_id, image_path FROM frames WHERE video_id IN (${placeholders}) AND image_path IS NOT NULL AND image_path NOT LIKE 'manual/%' ORDER BY video_id, timestamp_sec`,
        videoIds
      );
      for (const row of framesResult.rows) {
        const vid = Number(row.video_id);
        if (!framePathsMap.has(vid)) framePathsMap.set(vid, []);
        framePathsMap.get(vid)!.push(String(row.image_path));
      }
    }

    res.json({
      results: paged.map(r => ({
        type: r.type,
        videoId: r.videoId,
        videoTitle: r.videoTitle,
        driveFileId: r.driveFileId,
        timestampSec: r.timestampSec,
        endSec: r.endSec,
        content: r.content,
        imagePath: r.imagePath,
        allFramePaths: framePathsMap.get(r.videoId) || [],
        rank: r.rank,
      })),
      total,
      query: q,
    });
  } finally {
    client.release();
  }
});

export default router;
