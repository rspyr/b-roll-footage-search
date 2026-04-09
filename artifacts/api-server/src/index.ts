import { logger } from "./lib/logger";

const requiredEnvVars = [
  { name: "DATABASE_URL", description: "PostgreSQL connection string" },
  { name: "SESSION_SECRET", description: "Secret for signing session cookies" },
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

async function start() {
  await ensureSessionTable();
  await resetZombieProcessingVideos();

  const { default: app } = await import("./app");

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
