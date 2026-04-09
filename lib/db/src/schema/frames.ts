import { pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { videosTable } from "./videos";

export const framesTable = pgTable("frames", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  timestampSec: real("timestamp_sec").notNull(),
  imagePath: text("image_path").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("frames_video_id_idx").on(table.videoId),
  index("frames_description_tsv_idx").using("gin", sql`to_tsvector('english', ${table.description})`),
]);

export const insertFrameSchema = createInsertSchema(framesTable).omit({ id: true, createdAt: true });
export type InsertFrame = z.infer<typeof insertFrameSchema>;
export type Frame = typeof framesTable.$inferSelect;
