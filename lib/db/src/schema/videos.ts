import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videosTable = pgTable("videos", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  driveFileId: text("drive_file_id").notNull().unique(),
  driveFolderId: text("drive_folder_id"),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size"),
  duration: integer("duration"),
  localPath: text("local_path"),
  thumbnailPath: text("thumbnail_path"),
  status: text("status").notNull().default("pending"),
  processingError: text("processing_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("videos_title_tsv_idx").using("gin", sql`to_tsvector('english', regexp_replace(${table.title}, '\\.[a-zA-Z0-9]+$', ''))`),
  index("videos_title_trgm_idx").using("gin", sql`lower(regexp_replace(${table.title}, '\\.[a-zA-Z0-9]+$', '')) gin_trgm_ops`),
]);

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
