import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { SearchContentQueryParams } from "@workspace/api-zod";
import { searchRateLimit } from "../../lib/rate-limit";
import { gemini } from "../../lib/gemini";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

const expandedQueryCache = new Map<string, { expanded: string; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

async function expandQuery(query: string): Promise<string> {
  const cacheKey = query.toLowerCase().trim();
  const cached = expandedQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.expanded;
  }

  try {
    const result = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [{
          text: `You are a search query expander for a B-roll video library. Given a user search query, expand it with synonyms and related terms to improve recall.

Query: "${query}"

Return the original query plus additional related search terms, all space-separated on a single line. Keep it concise (under 20 words total). Do NOT add explanations.`,
        }],
      }],
      config: { maxOutputTokens: 100 },
    });

    const expanded = result.text?.trim() || query;
    expandedQueryCache.set(cacheKey, { expanded, ts: Date.now() });

    if (expandedQueryCache.size > 500) {
      const oldest = [...expandedQueryCache.entries()]
        .sort((a, b) => a[1].ts - b[1].ts)
        .slice(0, 100);
      for (const [key] of oldest) expandedQueryCache.delete(key);
    }

    return expanded;
  } catch (err) {
    logger.warn({ err, query }, "Query expansion failed, using original query");
    return query;
  }
}

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

  const [queryEmbedding, expandedQuery] = await Promise.all([
    embedQuery(q),
    expandQuery(q),
  ]);

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
        const VECTOR_BOOST = 2;
        const rrfScore = (1 / (60 + i + 1)) * VECTOR_BOOST;
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

      const ftsResult = await client.query(ftsQuery, [expandedQuery, fetchLimit]);

      const FTS_FRAME_BOOST = 0.5;
      for (let i = 0; i < ftsResult.rows.length; i++) {
        const row = ftsResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * FTS_FRAME_BOOST;
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

    if (type === "all") {
      const cleanTitle = `regexp_replace(v.title, '\\.[a-zA-Z0-9]+$', '')`;

      const titleFtsQuery = `
        SELECT
          v.id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          v.title as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          ts_rank(to_tsvector('english', ${cleanTitle}), plainto_tsquery('english', $1)) as rank
        FROM videos v
        WHERE to_tsvector('english', ${cleanTitle}) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `;

      const titleFtsResult = await client.query(titleFtsQuery, [expandedQuery, fetchLimit]);
      const TITLE_FTS_BOOST = 3;

      for (let i = 0; i < titleFtsResult.rows.length; i++) {
        const row = titleFtsResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * TITLE_FTS_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Title match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "title",
        });
      }

      const titleFuzzyQuery = `
        SELECT
          v.id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          v.title as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          word_similarity($1, lower(${cleanTitle})) as sim
        FROM videos v
        WHERE word_similarity($1, lower(${cleanTitle})) > 0.3
        ORDER BY sim DESC
        LIMIT $2
      `;

      const titleFuzzyResult = await client.query(titleFuzzyQuery, [q.toLowerCase(), fetchLimit]);
      const TITLE_FUZZY_BOOST = 2;

      for (let i = 0; i < titleFuzzyResult.rows.length; i++) {
        const row = titleFuzzyResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * TITLE_FUZZY_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Title match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "title_fuzzy",
        });
      }
    }

    if (type === "all") {
      const tagFtsQuery = `
        SELECT
          v.id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          v.tags as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          ts_rank(to_tsvector('english', v.tags), plainto_tsquery('english', $1)) as rank
        FROM videos v
        WHERE v.tags IS NOT NULL
          AND to_tsvector('english', v.tags) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `;

      const tagFtsResult = await client.query(tagFtsQuery, [expandedQuery, fetchLimit]);
      const TAG_FTS_BOOST = 4;

      for (let i = 0; i < tagFtsResult.rows.length; i++) {
        const row = tagFtsResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * TAG_FTS_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Tag match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "tags",
        });
      }

      const tagFuzzyQuery = `
        SELECT
          v.id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          v.tags as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          word_similarity($1, lower(v.tags)) as sim
        FROM videos v
        WHERE v.tags IS NOT NULL
          AND word_similarity($1, lower(v.tags)) > 0.3
        ORDER BY sim DESC
        LIMIT $2
      `;

      const tagFuzzyResult = await client.query(tagFuzzyQuery, [q.toLowerCase(), fetchLimit]);

      const TAG_FUZZY_BOOST = 3;
      for (let i = 0; i < tagFuzzyResult.rows.length; i++) {
        const row = tagFuzzyResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * TAG_FUZZY_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Tag match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "tags_fuzzy",
        });
      }
    }

    if (type === "all" || type === "visual") {
      const descFuzzyQuery = `
        SELECT
          f.video_id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          f.timestamp_sec as "timestampSec",
          NULL::double precision as "endSec",
          f.description as content,
          f.image_path as "imagePath",
          word_similarity($1, lower(f.description)) as sim
        FROM frames f
        JOIN videos v ON v.id = f.video_id
        WHERE f.description IS NOT NULL
          AND word_similarity($1, lower(f.description)) > 0.3
        ORDER BY sim DESC
        LIMIT $2
      `;

      const descFuzzyResult = await client.query(descFuzzyQuery, [q.toLowerCase(), fetchLimit]);

      const DESC_FUZZY_BOOST = 0.5;
      for (let i = 0; i < descFuzzyResult.rows.length; i++) {
        const row = descFuzzyResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * DESC_FUZZY_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: Number(row.timestampSec),
          endSec: null,
          content: String(row.content),
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "desc_fuzzy",
        });
      }
    }

    if (type === "all") {
      const annotationFtsQuery = `
        SELECT
          va.video_id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          va.content as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          ts_rank(to_tsvector('english', va.content), plainto_tsquery('english', $1)) as rank
        FROM video_annotations va
        JOIN videos v ON v.id = va.video_id
        WHERE to_tsvector('english', va.content) @@ plainto_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2
      `;

      const annotationFtsResult = await client.query(annotationFtsQuery, [expandedQuery, fetchLimit]);
      const ANNOTATION_FTS_BOOST = 5;

      for (let i = 0; i < annotationFtsResult.rows.length; i++) {
        const row = annotationFtsResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * ANNOTATION_FTS_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Annotation match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "annotation_fts",
        });
      }

      const annotationFuzzyQuery = `
        SELECT
          va.video_id as "videoId",
          v.title as "videoTitle",
          v.drive_file_id as "driveFileId",
          v.duration::double precision as "endSec",
          va.content as content,
          (SELECT f.image_path FROM frames f WHERE f.video_id = v.id ORDER BY f.timestamp_sec LIMIT 1) as "imagePath",
          word_similarity($1, lower(va.content)) as sim
        FROM video_annotations va
        JOIN videos v ON v.id = va.video_id
        WHERE word_similarity($1, lower(va.content)) > 0.3
        ORDER BY sim DESC
        LIMIT $2
      `;

      const annotationFuzzyResult = await client.query(annotationFuzzyQuery, [q.toLowerCase(), fetchLimit]);
      const ANNOTATION_FUZZY_BOOST = 4;

      for (let i = 0; i < annotationFuzzyResult.rows.length; i++) {
        const row = annotationFuzzyResult.rows[i];
        const rrfScore = (1 / (60 + i + 1)) * ANNOTATION_FUZZY_BOOST;
        allResults.push({
          type: "frame",
          videoId: Number(row.videoId),
          videoTitle: String(row.videoTitle),
          driveFileId: row.driveFileId ? String(row.driveFileId) : null,
          timestampSec: 0,
          endSec: row.endSec != null ? Number(row.endSec) : null,
          content: `Annotation match: ${String(row.content)}`,
          imagePath: row.imagePath ? String(row.imagePath) : null,
          rank: rrfScore,
          source: "annotation_fuzzy",
        });
      }
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

    const feedbackQuery = `
      SELECT
        video_id as "videoId",
        feedback_type as "feedbackType",
        count(*)::int as count
      FROM search_feedback
      WHERE to_tsvector('english', query) @@ plainto_tsquery('english', $1)
      GROUP BY video_id, feedback_type
    `;
    const feedbackResult = await client.query(feedbackQuery, [q]);
    const feedbackMap = new Map<number, { up: number; down: number }>();
    for (const row of feedbackResult.rows) {
      const vid = Number(row.videoId);
      if (!feedbackMap.has(vid)) feedbackMap.set(vid, { up: 0, down: 0 });
      const entry = feedbackMap.get(vid)!;
      if (row.feedbackType === "up") entry.up = Number(row.count);
      else if (row.feedbackType === "down") entry.down = Number(row.count);
    }

    const DOWNVOTE_DECAY = 0.70;
    const UPVOTE_BOOST = 1.15;
    const MIN_MULTIPLIER = 0.15;
    const MAX_MULTIPLIER = 2.0;
    for (const [videoId, merged] of mergedMap) {
      const fb = feedbackMap.get(videoId);
      if (fb) {
        const net = fb.up - fb.down;
        let multiplier = 1;
        if (net < 0) {
          multiplier = Math.pow(DOWNVOTE_DECAY, Math.abs(net));
        } else if (net > 0) {
          multiplier = Math.pow(UPVOTE_BOOST, net);
        }
        merged.rank *= Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, multiplier));
      }
    }

    const allMerged = Array.from(mergedMap.values())
      .sort((a, b) => b.rank - a.rank);

    const total = allMerged.length;
    const paged = allMerged.slice(offset, offset + limit);

    const videoIds = [...new Set(paged.map(r => r.videoId))];
    const framePathsMap = new Map<number, string[]>();
    const tagsMap = new Map<number, string | null>();
    if (videoIds.length > 0) {
      const placeholders = videoIds.map((_, i) => `$${i + 1}`).join(",");
      const [framesResult, tagsResult] = await Promise.all([
        client.query(
          `SELECT video_id, image_path FROM frames WHERE video_id IN (${placeholders}) AND image_path IS NOT NULL AND image_path NOT LIKE 'manual/%' ORDER BY video_id, timestamp_sec`,
          videoIds
        ),
        client.query(
          `SELECT id, tags FROM videos WHERE id IN (${placeholders})`,
          videoIds
        ),
      ]);
      for (const row of framesResult.rows) {
        const vid = Number(row.video_id);
        if (!framePathsMap.has(vid)) framePathsMap.set(vid, []);
        framePathsMap.get(vid)!.push(String(row.image_path));
      }
      for (const row of tagsResult.rows) {
        tagsMap.set(Number(row.id), row.tags ? String(row.tags) : null);
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
        videoTags: tagsMap.get(r.videoId) || null,
      })),
      total,
      query: q,
      expandedQuery: expandedQuery !== q ? expandedQuery : undefined,
    });
  } finally {
    client.release();
  }
});

router.post("/search/feedback", async (req, res): Promise<void> => {
  const { videoId, query, feedbackType } = req.body;

  if (!videoId || !query || !feedbackType) {
    res.status(400).json({ error: "videoId, query, and feedbackType are required" });
    return;
  }

  if (feedbackType !== "up" && feedbackType !== "down") {
    res.status(400).json({ error: "feedbackType must be 'up' or 'down'" });
    return;
  }

  const userId = req.session.userId;
  const normalizedQuery = String(query).trim().toLowerCase();

  if (!normalizedQuery) {
    res.status(400).json({ error: "query cannot be empty" });
    return;
  }

  try {
    const { searchFeedbackTable, videosTable, db } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const video = await db.select({ id: videosTable.id }).from(videosTable).where(eq(videosTable.id, Number(videoId))).limit(1);
    if (video.length === 0) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    await db.insert(searchFeedbackTable).values({
      userId,
      videoId: Number(videoId),
      query: normalizedQuery,
      feedbackType,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to submit search feedback");
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

export default router;
