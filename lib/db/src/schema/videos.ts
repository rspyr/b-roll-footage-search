import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
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
});

export const insertVideoSchema = createInsertSchema(videosTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
