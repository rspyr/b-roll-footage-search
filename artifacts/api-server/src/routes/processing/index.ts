import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, videosTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/processing/status", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'synced') as synced,
      COUNT(*) FILTER (WHERE status = 'processing') as processing,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) as total
    FROM videos
  `);

  const row = result.rows[0];
  res.json({
    pending: Number(row.pending),
    synced: Number(row.synced),
    processing: Number(row.processing),
    completed: Number(row.completed),
    failed: Number(row.failed),
    total: Number(row.total),
  });
});

export default router;
