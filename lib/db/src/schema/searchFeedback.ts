import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { videosTable } from "./videos";
import { usersTable } from "./users";

export const searchFeedbackTable = pgTable("search_feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  feedbackType: text("feedback_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("search_feedback_video_id_idx").on(table.videoId),
  index("search_feedback_query_tsv_idx").using("gin", sql`to_tsvector('english', ${table.query})`),
]);

export type SearchFeedback = typeof searchFeedbackTable.$inferSelect;
