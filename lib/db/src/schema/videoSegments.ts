import { pgTable, serial, timestamp, integer, real, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { videosTable } from "./videos";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map(Number);
  },
});

export const videoSegmentsTable = pgTable("video_segments", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").notNull().references(() => videosTable.id, { onDelete: "cascade" }),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("video_segments_video_id_idx").on(table.videoId),
]);

export const insertVideoSegmentSchema = createInsertSchema(videoSegmentsTable).omit({ id: true, createdAt: true });
export type InsertVideoSegment = z.infer<typeof insertVideoSegmentSchema>;
export type VideoSegment = typeof videoSegmentsTable.$inferSelect;
