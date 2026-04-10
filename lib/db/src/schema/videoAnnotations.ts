import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { videosTable } from "./videos";
import { usersTable } from "./users";

export const videoAnnotationsTable = pgTable("video_annotations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("video_annotations_video_id_idx").on(table.videoId),
  index("video_annotations_content_tsv_idx").using("gin", sql`to_tsvector('english', ${table.content})`),
  index("video_annotations_content_trgm_idx").using("gin", sql`lower(${table.content}) gin_trgm_ops`),
]);

export type VideoAnnotation = typeof videoAnnotationsTable.$inferSelect;
