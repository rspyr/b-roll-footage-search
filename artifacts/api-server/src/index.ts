import { logger } from "./lib/logger";

const requiredEnvVars = [
  { name: "DATABASE_URL", description: "PostgreSQL connection string" },
  { name: "SESSION_SECRET", description: "Secret for signing session cookies" },
  { name: "GEMINI_API_KEY", description: "Gemini API key for video analysis and embeddings" },
  { name: "AI_INTEGRATIONS_OPENAI_BASE_URL", description: "OpenAI integration base URL" },
  { name: "AI_INTEGRATIONS_OPENAI_API_KEY", description: "OpenAI integration API key" },
];

const missing = requiredEnvVars.filter((v) => !process.env[v.name]);
if (missing.length > 0) {
  for (const v of missing) {
    logger.fatal(`Missing required environment variable: ${v.name} (${v.description})`);
  }
  process.exit(1);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  logger.fatal("PORT environment variable is required but was not provided.");
  process.exit(1);
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.fatal(`Invalid PORT value: "${rawPort}"`);
  process.exit(1);
}

async function resetZombieProcessingVideos() {
  const { db, videosTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const zombies = await db
    .update(videosTable)
    .set({ status: "pending" })
    .where(eq(videosTable.status, "processing"))
    .returning({ id: videosTable.id });

  if (zombies.length > 0) {
    logger.info(
      { videoIds: zombies.map((v) => v.id) },
      `Reset ${zombies.length} zombie video(s) from "processing" to "pending"`,
    );
  }
}

async function ensureSessionTable() {
  const { pool } = await import("@workspace/db");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    );
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
  `);
}

async function ensureSearchIndexes() {
  const { pool } = await import("@workspace/db");
  await pool.query(`CREATE INDEX IF NOT EXISTS videos_title_tsv_idx ON videos USING gin (to_tsvector('english', regexp_replace(title, '\\.[a-zA-Z0-9]+$', '')));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS videos_title_trgm_idx ON videos USING gin (lower(regexp_replace(title, '\\.[a-zA-Z0-9]+$', '')) gin_trgm_ops);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS videos_tags_tsv_idx ON videos USING gin (to_tsvector('english', tags));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS videos_tags_trgm_idx ON videos USING gin (lower(tags) gin_trgm_ops);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS frames_description_tsv_idx ON frames USING gin (to_tsvector('english', description));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS frames_description_trgm_idx ON frames USING gin (lower(description) gin_trgm_ops);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS transcriptions_content_tsv_idx ON transcriptions USING gin (to_tsvector('english', content));`);
}

async function ensureVideoSegmentsTable() {
  const { pool } = await import("@workspace/db");
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_segments (
      id SERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      start_sec REAL NOT NULL DEFAULT 0,
      end_sec REAL NOT NULL DEFAULT 0,
      embedding vector(768),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'video_segments_embedding_idx'
      ) THEN
        CREATE INDEX video_segments_embedding_idx ON video_segments
        USING hnsw (embedding vector_cosine_ops);
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS video_segments_video_id_idx ON video_segments (video_id);
  `);
}

async function ensureFeedbackTables() {
  const { pool } = await import("@workspace/db");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      feedback_type TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS search_feedback_video_id_idx ON search_feedback (video_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS search_feedback_query_tsv_idx ON search_feedback USING gin (to_tsvector('english', query));`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS video_annotations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS video_annotations_video_id_idx ON video_annotations (video_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS video_annotations_content_tsv_idx ON video_annotations USING gin (to_tsvector('english', content));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS video_annotations_content_trgm_idx ON video_annotations USING gin (lower(content) gin_trgm_ops);`);
}

async function autoBackfillTags() {
  const { db, videosTable, framesTable, transcriptionsTable, videoAnnotationsTable } = await import("@workspace/db");
  const { eq, isNull, and } = await import("drizzle-orm");
  const { generateVideoTags } = await import("./lib/video-processor");
  const { pool } = await import("@workspace/db");

  const videosNeedingTags = await db.select({
    id: videosTable.id,
    title: videosTable.title,
  }).from(videosTable)
    .where(and(eq(videosTable.status, "completed"), isNull(videosTable.tags)));

  if (videosNeedingTags.length === 0) {
    logger.info("No videos need tag backfill");
    return;
  }

  logger.info({ count: videosNeedingTags.length }, "Starting auto tag backfill");
  let succeeded = 0;
  let failed = 0;

  for (const video of videosNeedingTags) {
    try {
      const frames = await db.select({ description: framesTable.description })
        .from(framesTable)
        .where(eq(framesTable.videoId, video.id));

      const transcriptions = await db.select({ content: transcriptionsTable.content })
        .from(transcriptionsTable)
        .where(eq(transcriptionsTable.videoId, video.id));

      const annotations = await db.select({ content: videoAnnotationsTable.content })
        .from(videoAnnotationsTable)
        .where(eq(videoAnnotationsTable.videoId, video.id));

      const neighborTags = await getNeighborTags(pool, video.id);

      const frameDescs = frames.map(f => f.description).filter(Boolean) as string[];
      const allTexts = [
        ...transcriptions.map(t => t.content).filter(Boolean) as string[],
        ...annotations.map(a => a.content),
      ];

      if (neighborTags.length > 0) {
        allTexts.push(`Related video tags: ${neighborTags.join(", ")}`);
      }

      const tags = await generateVideoTags(video.title, frameDescs, allTexts);
      await db.update(videosTable).set({ tags }).where(eq(videosTable.id, video.id));
      succeeded++;
      logger.info({ videoId: video.id }, "Auto-backfilled tags");
    } catch (err) {
      failed++;
      logger.error({ videoId: video.id, err }, "Failed to auto-backfill tags");
    }
  }

  logger.info({ succeeded, failed, total: videosNeedingTags.length }, "Auto tag backfill complete");

  if (succeeded > 0) {
    await propagateTagsViaEmbeddings(pool);
  }
}

async function getNeighborTags(poolClient: any, videoId: number): Promise<string[]> {
  try {
    const result = await poolClient.query(`
      WITH source_embedding AS (
        SELECT embedding FROM video_segments
        WHERE video_id = $1 AND embedding IS NOT NULL
        LIMIT 1
      )
      SELECT v.tags, MIN(vs.embedding <=> se.embedding) as dist
      FROM source_embedding se, video_segments vs
      JOIN videos v ON v.id = vs.video_id
      WHERE vs.video_id != $1
        AND vs.embedding IS NOT NULL
        AND v.tags IS NOT NULL
        AND v.tags != ''
      GROUP BY v.id, v.tags
      ORDER BY dist
      LIMIT 3
    `, [videoId]);

    const allTags: string[] = [];
    for (const row of result.rows) {
      if (row.tags) {
        allTags.push(...String(row.tags).split(",").map((t: string) => t.trim()).filter(Boolean));
      }
    }
    return [...new Set(allTags)].slice(0, 30);
  } catch (err) {
    logger.warn({ err, videoId }, "Failed to get neighbor tags (non-fatal)");
    return [];
  }
}

async function propagateTagsViaEmbeddings(poolClient: any) {
  const { db, videosTable } = await import("@workspace/db");
  const { eq, and, isNotNull, sql } = await import("drizzle-orm");

  const videosWithTags = await db.select({
    id: videosTable.id,
    title: videosTable.title,
    tags: videosTable.tags,
  }).from(videosTable)
    .where(and(
      eq(videosTable.status, "completed"),
      isNotNull(videosTable.tags),
    ));

  if (videosWithTags.length < 2) return;

  logger.info({ count: videosWithTags.length }, "Starting embedding-based tag propagation");
  let enriched = 0;

  for (const video of videosWithTags) {
    try {
      const neighborTags = await getNeighborTags(poolClient, video.id);
      if (neighborTags.length === 0) continue;

      const currentTags = new Set(
        String(video.tags).split(",").map(t => t.trim().toLowerCase()).filter(Boolean)
      );
      const newTags = neighborTags.filter(t => !currentTags.has(t.toLowerCase()));

      if (newTags.length === 0) continue;

      const merged = `${video.tags}, ${newTags.slice(0, 10).join(", ")}`;
      await db.update(videosTable).set({ tags: merged }).where(eq(videosTable.id, video.id));
      enriched++;
      logger.info({ videoId: video.id, newTagCount: newTags.length }, "Propagated neighbor tags");
    } catch (err) {
      logger.warn({ videoId: video.id, err }, "Tag propagation failed for video (non-fatal)");
    }
  }

  logger.info({ enriched, total: videosWithTags.length }, "Tag propagation complete");
}

async function start() {
  await ensureSessionTable();
  await ensureVideoSegmentsTable();
  await ensureSearchIndexes();
  await ensureFeedbackTables();
  await resetZombieProcessingVideos();

  const { default: app } = await import("./app");

  app.listen(port, async () => {
    logger.info({ port }, "Server listening");

    const { db, videosTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const pending = await db.select({ id: videosTable.id }).from(videosTable).where(eq(videosTable.status, "pending")).limit(1);
    if (pending.length > 0) {
      logger.info("Found pending videos, starting processing queue");
      const { startProcessingQueue } = await import("./lib/video-processor");
      startProcessingQueue().catch((err) => {
        logger.error({ err }, "Background processing queue failed");
      });
    }

    autoBackfillTags().catch((err) => {
      logger.error({ err }, "Auto tag backfill failed");
    });
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
