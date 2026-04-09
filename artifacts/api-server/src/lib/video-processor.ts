import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { openai } from "@workspace/integrations-openai-ai-server";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { db, videosTable, framesTable, transcriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { downloadFile } from "./google-drive";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(process.cwd(), "data");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const FRAMES_DIR = path.join(DATA_DIR, "frames");

function ensureDirs() {
  for (const dir of [DATA_DIR, VIDEOS_DIR, FRAMES_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  return Math.floor(parseFloat(stdout.trim()));
}

export async function extractFrames(videoPath: string, videoId: number, intervalSec: number = 5): Promise<string[]> {
  const framesDir = path.join(FRAMES_DIR, String(videoId));
  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir, { recursive: true });
  }

  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vf", `fps=1/${intervalSec}`,
    "-q:v", "2",
    "-f", "image2",
    path.join(framesDir, "frame_%04d.jpg"),
  ]);

  const files = fs.readdirSync(framesDir)
    .filter(f => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort();

  return files.map(f => path.join(framesDir, f));
}

export async function extractAudio(videoPath: string, videoId: number): Promise<string> {
  const audioPath = path.join(VIDEOS_DIR, `${videoId}_audio.wav`);

  await execFileAsync("ffmpeg", [
    "-i", videoPath,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y",
    audioPath,
  ]);

  return audioPath;
}

async function describeFrame(imagePath: string): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");
  const mimeType = "image/jpeg";

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 300,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this video frame in detail for search purposes. Include: visual elements, actions, objects, people, scenery, colors, mood, lighting, and any text visible. Be specific and descriptive. Output only the description, no preamble.",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: "low",
            },
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "No description available";
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeAudio(audioPath: string): Promise<WhisperSegment[]> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.wav", { type: "audio/wav" });

  try {
    const response = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file: audioFile,
      response_format: "json",
    });

    const text = typeof response === "string" ? response : (response as { text: string }).text;
    if (!text || text.trim().length === 0) {
      return [];
    }

    const duration = audioBuffer.length / (16000 * 2);

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const segDuration = duration / Math.max(sentences.length, 1);

    return sentences.map((sentence, i) => ({
      start: Math.round(i * segDuration * 100) / 100,
      end: Math.round((i + 1) * segDuration * 100) / 100,
      text: sentence.trim(),
    }));
  } catch (err) {
    logger.error({ err }, "Transcription failed");
    return [];
  }
}

export async function processVideo(videoId: number): Promise<void> {
  ensureDirs();

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) {
    throw new Error(`Video ${videoId} not found`);
  }

  await db.update(videosTable).set({ status: "processing" }).where(eq(videosTable.id, videoId));

  try {
    let videoPath = video.localPath;

    if (!videoPath || !fs.existsSync(videoPath)) {
      videoPath = path.join(VIDEOS_DIR, `${videoId}_${video.title.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      logger.info({ videoId, driveFileId: video.driveFileId }, "Downloading video from Drive");
      await downloadFile(video.driveFileId, videoPath);
      await db.update(videosTable).set({ localPath: videoPath }).where(eq(videosTable.id, videoId));
    }

    const duration = await getVideoDuration(videoPath);
    await db.update(videosTable).set({ duration }).where(eq(videosTable.id, videoId));
    logger.info({ videoId, duration }, "Got video duration");

    logger.info({ videoId }, "Extracting frames");
    const framePaths = await extractFrames(videoPath, videoId);
    logger.info({ videoId, frameCount: framePaths.length }, "Frames extracted");

    logger.info({ videoId }, "Describing frames with GPT Vision");
    const frameDescriptions = await batchProcess(
      framePaths,
      async (framePath) => {
        const description = await describeFrame(framePath);
        return { framePath, description };
      },
      { concurrency: 2, retries: 3 },
    );

    for (let i = 0; i < frameDescriptions.length; i++) {
      const { framePath, description } = frameDescriptions[i];
      const relativePath = path.relative(FRAMES_DIR, framePath);
      await db.insert(framesTable).values({
        videoId,
        timestampSec: i * 5,
        imagePath: relativePath,
        description,
      });
    }
    logger.info({ videoId, describedCount: frameDescriptions.length }, "Frame descriptions saved");

    logger.info({ videoId }, "Extracting and transcribing audio");
    try {
      const audioPath = await extractAudio(videoPath, videoId);
      const segments = await transcribeAudio(audioPath);

      for (const segment of segments) {
        await db.insert(transcriptionsTable).values({
          videoId,
          startSec: segment.start,
          endSec: segment.end,
          content: segment.text,
        });
      }
      logger.info({ videoId, segmentCount: segments.length }, "Transcriptions saved");

      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    } catch (err) {
      logger.warn({ videoId, err }, "Audio extraction/transcription failed, continuing without transcription");
    }

    const thumbnailPath = framePaths[0] ? path.relative(FRAMES_DIR, framePaths[0]) : null;
    await db.update(videosTable).set({
      status: "completed",
      thumbnailPath,
    }).where(eq(videosTable.id, videoId));

    logger.info({ videoId }, "Video processing completed");
  } catch (err) {
    logger.error({ videoId, err }, "Video processing failed");
    await db.update(videosTable).set({
      status: "failed",
      processingError: err instanceof Error ? err.message : String(err),
    }).where(eq(videosTable.id, videoId));
    throw err;
  }
}

export async function processNextPending(): Promise<void> {
  const [nextVideo] = await db.select().from(videosTable)
    .where(eq(videosTable.status, "pending"))
    .orderBy(videosTable.createdAt)
    .limit(1);

  if (nextVideo) {
    await processVideo(nextVideo.id);
  }
}

let processingActive = false;

export async function startProcessingQueue(): Promise<void> {
  if (processingActive) return;
  processingActive = true;

  try {
    while (true) {
      const [nextVideo] = await db.select().from(videosTable)
        .where(eq(videosTable.status, "pending"))
        .orderBy(videosTable.createdAt)
        .limit(1);

      if (!nextVideo) break;

      try {
        await processVideo(nextVideo.id);
      } catch (err) {
        logger.error({ videoId: nextVideo.id, err }, "Failed to process video in queue, moving to next");
      }
    }
  } finally {
    processingActive = false;
  }
}
