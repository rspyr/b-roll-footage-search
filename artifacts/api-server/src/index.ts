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

async function start() {
  await ensureSessionTable();
  await ensureVideoSegmentsTable();
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
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
