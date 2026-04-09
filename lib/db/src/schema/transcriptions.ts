import { pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { videosTable } from "./videos";

export const transcriptionsTable = pgTable("transcriptions", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  content: text("content").notNull(),
  contentTsv: text("content_tsv"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("transcriptions_video_id_idx").on(table.videoId),
  index("transcriptions_content_tsv_idx").using("gin", sql`to_tsvector('english', ${table.content})`),
]);

export const insertTranscriptionSchema = createInsertSchema(transcriptionsTable).omit({ id: true, createdAt: true, contentTsv: true });
export type InsertTranscription = z.infer<typeof insertTranscriptionSchema>;
export type Transcription = typeof transcriptionsTable.$inferSelect;
