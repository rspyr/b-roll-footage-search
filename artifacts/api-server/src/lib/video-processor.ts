import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, videosTable, framesTable, transcriptionsTable, videoSegmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { downloadFile } from "./google-drive";
import { logger } from "./logger";
import { gemini } from "./gemini";
import { uploadFrame, deleteVideoFrames } from "./frame-storage";

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(process.cwd(), "data");
const VIDEOS_DIR = path.join(DATA_DIR, "videos");
const FRAMES_DIR = path.join(DATA_DIR, "frames");
const SEGMENTS_DIR = path.join(DATA_DIR, "segments");

const MAX_SEGMENT_DURATION = 90;
const SEGMENT_OVERLAP = 10;
const MAX_EMBED_DURATION = 120;
const MAX_SEGMENT_FILE_SIZE_MB = 50;

interface ProcessingState {
  videoId: number | null;
  videoTitle: string | null;
  step: string | null;
  startedAt: number | null;
  stepStartedAt: number | null;
  current: number | null;
  total: number | null;
  bytesDownloaded: number | null;
  bytesTotal: number | null;
}

const currentProcessingState: ProcessingState = {
  videoId: null,
  videoTitle: null,
  step: null,
  startedAt: null,
  stepStartedAt: null,
  current: null,
  total: null,
  bytesDownloaded: null,
  bytesTotal: null,
};

const cancelledVideoIds = new Set<number>();

export function requestCancellation(videoId: number): void {
  cancelledVideoIds.add(videoId);
}

export function isCancelled(videoId: number): boolean {
  return cancelledVideoIds.has(videoId);
}

export function getProcessingState(): ProcessingState {
  return { ...currentProcessingState };
}

function updateProcessingStep(step: string) {
  currentProcessingState.step = step;
  currentProcessingState.stepStartedAt = Date.now();
  currentProcessingState.current = null;
  currentProcessingState.total = null;
  currentProcessingState.bytesDownloaded = null;
  currentProcessingState.bytesTotal = null;
}

function updateSubstepProgress(current: number, total: number) {
  currentProcessingState.current = current;
  currentProcessingState.total = total;
}

function updateDownloadProgress(bytesDownloaded: number, bytesTotal: number | null) {
  currentProcessingState.bytesDownloaded = bytesDownloaded;
  currentProcessingState.bytesTotal = bytesTotal;
}

function ensureDirs() {
  for (const dir of [DATA_DIR, VIDEOS_DIR, FRAMES_DIR, SEGMENTS_DIR]) {
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
    "-y",
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

const FRAME_DESCRIPTION_PROMPT = `Analyze this video frame in thorough detail for a B-roll search index. You MUST cover ALL of the following categories:

**Physical States & Body Language:**
- Breathing patterns (panting, heavy breathing, labored breathing, gasping)
- Signs of temperature (sweating, perspiring, flushed, overheated, shivering, cold)
- Physical exertion indicators (exhaustion, fatigue, strain, effort)
- Posture and body position (slouching, leaning, crouching, standing)

**Animal Behavior (if animals present):**
- Panting (tongue out, rapid breathing, drooling, salivating)
- Emotional state (anxious, stressed, relaxed, excited, fearful, aggressive, playful)
- Breed identification if possible
- Tail position, ear position, eye state (half-closed, alert, droopy)

**Human Behavior & Emotions (if people present):**
- Facial expressions and emotional state (happy, frustrated, tired, focused, distressed)
- Activities and actions in detail
- Physical condition (sweaty, dry, clean, dirty, wet)

**Environment & Context:**
- Temperature cues (hot environment, cold environment, steam, ice, condensation)
- Indoor/outdoor, lighting conditions
- Weather indicators
- Objects, furniture, equipment present

**Actions & Movement:**
- What is happening in the scene
- Speed and intensity of movement
- Interactions between subjects

Be specific and accurate. Do NOT downplay or soften what you see. If a dog is panting with its tongue out, say "panting heavily with tongue extended" — do NOT say "relaxed and comfortable." If someone is sweating, say "visibly sweating/perspiring." Output only the description, no preamble.`;

async function describeFrame(imagePath: string): Promise<string> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { text: FRAME_DESCRIPTION_PROMPT },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            },
          },
        ],
      },
    ],
    config: {
      maxOutputTokens: 4096,
    },
  });

  return response.text ?? "No description available";
}

async function describeFrameGroup(imagePaths: string[]): Promise<string> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are analyzing ${imagePaths.length} consecutive frames from a video, taken a few seconds apart. Analyze them TOGETHER to understand the temporal context — what is happening over time, not just in a single instant.

${FRAME_DESCRIPTION_PROMPT}

Additionally, describe any CHANGES or PROGRESSION visible across the frames (e.g., "the dog continues panting across all frames, indicating sustained heavy breathing" or "the person's sweating increases between frames").`,
    },
  ];

  for (const imagePath of imagePaths) {
    const imageBuffer = fs.readFileSync(imagePath);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: imageBuffer.toString("base64"),
      },
    });
  }

  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts }],
    config: {
      maxOutputTokens: 4096,
    },
  });

  return response.text ?? "No description available";
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

interface VideoSegmentInfo {
  startSec: number;
  endSec: number;
  filePath: string;
}

async function segmentVideo(videoPath: string, videoId: number, duration: number, onProgress?: (current: number, total: number) => void): Promise<VideoSegmentInfo[]> {
  logger.info({ videoId, duration }, "Starting video segmentation");
  const segDir = path.join(SEGMENTS_DIR, String(videoId));
  if (!fs.existsSync(segDir)) {
    fs.mkdirSync(segDir, { recursive: true });
  }

  const videoStats = fs.statSync(videoPath);
  const videoSizeMB = videoStats.size / (1024 * 1024);

  if (duration <= MAX_EMBED_DURATION && videoSizeMB <= MAX_SEGMENT_FILE_SIZE_MB) {
    if (onProgress) onProgress(1, 1);
    return [{ startSec: 0, endSec: duration, filePath: videoPath }];
  }

  const bitratePerSec = videoSizeMB / Math.max(duration, 1);
  const targetSegDuration = bitratePerSec > 0
    ? Math.min(MAX_SEGMENT_DURATION, Math.floor(MAX_SEGMENT_FILE_SIZE_MB / bitratePerSec))
    : MAX_SEGMENT_DURATION;
  const effectiveSegDuration = Math.max(targetSegDuration, 15);

  logger.info({ videoId, videoSizeMB: Math.round(videoSizeMB), bitratePerSec: bitratePerSec.toFixed(2), effectiveSegDuration }, "Calculated segment duration for video");

  const segments: VideoSegmentInfo[] = [];
  let startSec = 0;

  const stepSize = effectiveSegDuration - SEGMENT_OVERLAP;
  const estimatedTotal = Math.max(1, Math.ceil(duration / Math.max(stepSize, 1)));

  while (startSec < duration) {
    if (onProgress) onProgress(segments.length, estimatedTotal);
    const endSec = Math.min(startSec + effectiveSegDuration, duration);
    const segmentPath = path.join(segDir, `segment_${String(segments.length).padStart(4, "0")}.mp4`);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-ss", String(startSec),
      "-t", String(endSec - startSec),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      segmentPath,
    ]);

    segments.push({ startSec, endSec, filePath: segmentPath });

    startSec = endSec - SEGMENT_OVERLAP;
    if (endSec >= duration) break;
  }

  if (onProgress) onProgress(segments.length, segments.length);

  return segments;
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mov": return "video/quicktime";
    case ".mp4": return "video/mp4";
    case ".avi": return "video/x-msvideo";
    case ".webm": return "video/webm";
    default: return "video/mp4";
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number = 3, label: string = "API call"): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const is429 = errMsg.includes("429") || errMsg.includes("rate") || errMsg.includes("quota");
      const is5xx = errMsg.includes("500") || errMsg.includes("503") || errMsg.includes("server");

      if (attempt < maxRetries && (is429 || is5xx)) {
        const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000);
        logger.warn({ attempt, backoff, label, err: errMsg }, "Retrying after error");
        await sleep(backoff);
      } else if (attempt < maxRetries) {
        const backoff = 1000 * (attempt + 1);
        logger.warn({ attempt, backoff, label, err: errMsg }, "Retrying after error");
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

async function embedVideoSegment(segmentInfo: VideoSegmentInfo): Promise<number[]> {
  const stats = fs.statSync(segmentInfo.filePath);
  const fileSizeMB = stats.size / (1024 * 1024);

  if (fileSizeMB > MAX_SEGMENT_FILE_SIZE_MB) {
    logger.warn(
      { filePath: segmentInfo.filePath, fileSizeMB: Math.round(fileSizeMB), maxMB: MAX_SEGMENT_FILE_SIZE_MB },
      "Segment file too large for embedding, skipping"
    );
    throw new Error(`Segment file too large (${Math.round(fileSizeMB)}MB > ${MAX_SEGMENT_FILE_SIZE_MB}MB limit)`);
  }

  const videoBytes = fs.readFileSync(segmentInfo.filePath);
  const base64Video = videoBytes.toString("base64");
  const mimeType = detectMimeType(segmentInfo.filePath);

  return withRetry(async () => {
    const result = await gemini.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Video,
            },
          },
        ],
      },
      config: {
        outputDimensionality: 768,
      },
    });

    const embedding = result.embeddings?.[0]?.values;
    if (!embedding) {
      throw new Error("No embedding returned from Gemini");
    }
    return embedding;
  }, 3, `embed-segment-${segmentInfo.startSec}s`);
}

class CancellationError extends Error {
  constructor(videoId: number) {
    super(`Video ${videoId} processing was cancelled`);
    this.name = "CancellationError";
  }
}

function checkCancellation(videoId: number): void {
  if (isCancelled(videoId)) {
    throw new CancellationError(videoId);
  }
}

export async function processVideo(videoId: number): Promise<void> {
  ensureDirs();

  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) {
    throw new Error(`Video ${videoId} not found`);
  }

  if (isCancelled(videoId)) {
    cancelledVideoIds.delete(videoId);
    await db.update(videosTable).set({ status: "cancelled" }).where(eq(videosTable.id, videoId));
    logger.info({ videoId }, "Video processing cancelled before start");
    return;
  }

  const claimed = await db.update(videosTable)
    .set({ status: "processing" })
    .where(and(eq(videosTable.id, videoId), eq(videosTable.status, "pending")))
    .returning({ id: videosTable.id });

  if (claimed.length === 0) {
    logger.info({ videoId, currentStatus: video.status }, "Video no longer pending, skipping processing");
    return;
  }

  currentProcessingState.videoId = videoId;
  currentProcessingState.videoTitle = video.title;
  currentProcessingState.startedAt = Date.now();
  updateProcessingStep("Preparing");

  await db.delete(framesTable).where(eq(framesTable.videoId, videoId));
  await db.delete(transcriptionsTable).where(eq(transcriptionsTable.videoId, videoId));
  await db.delete(videoSegmentsTable).where(eq(videoSegmentsTable.videoId, videoId));
  await deleteVideoFrames(videoId);

  let videoPath = video.localPath;

  try {

    checkCancellation(videoId);

    if (!videoPath || !fs.existsSync(videoPath)) {
      updateProcessingStep("Downloading from Drive");
      videoPath = path.join(VIDEOS_DIR, `${videoId}_${video.title.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      logger.info({ videoId, driveFileId: video.driveFileId }, "Downloading video from Drive");
      await downloadFile(video.driveFileId, videoPath, (bytesDownloaded, bytesTotal) => {
        updateDownloadProgress(bytesDownloaded, bytesTotal);
      });
      await db.update(videosTable).set({ localPath: videoPath }).where(eq(videosTable.id, videoId));
    }

    const duration = await getVideoDuration(videoPath);
    await db.update(videosTable).set({ duration }).where(eq(videosTable.id, videoId));
    logger.info({ videoId, duration }, "Got video duration");

    const frameInterval = duration <= 30 ? 2 : (duration > 120 ? 10 : 5);
    checkCancellation(videoId);
    updateProcessingStep("Extracting frames");
    logger.info({ videoId, frameInterval, duration }, "Extracting frames");
    let framePaths = await extractFrames(videoPath, videoId, frameInterval);
    logger.info({ videoId, frameCount: framePaths.length }, "Frames extracted");

    const MAX_FRAMES = 30;
    if (framePaths.length > MAX_FRAMES) {
      const step = Math.ceil(framePaths.length / MAX_FRAMES);
      const sampledPaths = framePaths.filter((_, idx) => idx % step === 0);
      logger.info({ videoId, originalCount: framePaths.length, sampledCount: sampledPaths.length }, "Sampled frames to stay within limit");
      framePaths = sampledPaths;
    }

    checkCancellation(videoId);
    updateProcessingStep("Analyzing frames");
    logger.info({ videoId }, "Describing frames with Gemini Vision");
    const frameDescriptions: Array<{ framePath: string; description: string; frameIndex: number }> = [];
    let framesAnalyzed = 0;

    let i = 0;
    while (i < framePaths.length) {
      checkCancellation(videoId);
      updateSubstepProgress(framesAnalyzed, framePaths.length);
      const groupSize = Math.min(3, framePaths.length - i);
      const groupPaths = framePaths.slice(i, i + groupSize);

      let groupDescription: string;
      try {
        if (groupSize >= 2) {
          groupDescription = await withRetry(
            () => describeFrameGroup(groupPaths),
            2,
            `describe-frame-group-${i}`
          );
        } else {
          groupDescription = await withRetry(
            () => describeFrame(groupPaths[0]),
            2,
            `describe-frame-${i}`
          );
        }
      } catch (err) {
        logger.warn({ videoId, frameIndex: i, err }, "Frame description failed, retrying single frame");
        try {
          groupDescription = await describeFrame(framePaths[i]);
        } catch (retryErr) {
          logger.error({ videoId, frameIndex: i, err: retryErr }, "Frame description retry failed");
          groupDescription = "Description unavailable";
        }
      }

      for (let j = 0; j < groupSize; j++) {
        frameDescriptions.push({
          framePath: framePaths[i + j],
          description: groupDescription,
          frameIndex: i + j,
        });
      }
      i += groupSize;
      framesAnalyzed = i;
      updateSubstepProgress(framesAnalyzed, framePaths.length);

      await sleep(500);
    }

    checkCancellation(videoId);
    updateProcessingStep("Uploading frames");
    logger.info({ videoId }, "Uploading frames to object storage");
    for (let fi = 0; fi < frameDescriptions.length; fi++) {
      const { framePath, description, frameIndex } = frameDescriptions[fi];
      updateSubstepProgress(fi, frameDescriptions.length);
      const relativePath = path.relative(FRAMES_DIR, framePath);
      await uploadFrame(framePath, relativePath);
      await db.insert(framesTable).values({
        videoId,
        timestampSec: frameIndex * frameInterval,
        imagePath: relativePath,
        description,
      });
    }
    updateSubstepProgress(frameDescriptions.length, frameDescriptions.length);
    logger.info({ videoId, describedCount: frameDescriptions.length }, "Frame descriptions saved");

    const localFramesDir = path.join(FRAMES_DIR, String(videoId));
    if (fs.existsSync(localFramesDir)) {
      fs.rmSync(localFramesDir, { recursive: true, force: true });
    }

    checkCancellation(videoId);
    updateProcessingStep("Transcribing audio");
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
      if (err instanceof CancellationError) throw err;
      logger.warn({ videoId, err }, "Audio extraction/transcription failed, continuing without transcription");
    }

    checkCancellation(videoId);
    updateProcessingStep("Segmenting video");
    logger.info({ videoId }, "Segmenting video and generating embeddings");
    try {
      const videoSegments = await segmentVideo(videoPath, videoId, duration, (current, total) => {
        updateSubstepProgress(current, total);
      });
      logger.info({ videoId, segmentCount: videoSegments.length }, "Video segmented");

      updateProcessingStep("Generating embeddings");
      for (let si = 0; si < videoSegments.length; si++) {
        const seg = videoSegments[si];
        checkCancellation(videoId);
        updateSubstepProgress(si, videoSegments.length);
        try {
          const embedding = await embedVideoSegment(seg);

          await db.insert(videoSegmentsTable).values({
            videoId,
            startSec: seg.startSec,
            endSec: seg.endSec,
            embedding,
          });

          logger.info({ videoId, startSec: seg.startSec, endSec: seg.endSec }, "Segment embedded and saved");
        } catch (err) {
          if (err instanceof CancellationError) throw err;
          logger.error({ videoId, startSec: seg.startSec, err }, "Failed to embed video segment, skipping");
        }

        await sleep(1000);
      }
      updateSubstepProgress(videoSegments.length, videoSegments.length);

      const segDir = path.join(SEGMENTS_DIR, String(videoId));
      if (fs.existsSync(segDir)) {
        const segFiles = fs.readdirSync(segDir);
        for (const f of segFiles) {
          fs.unlinkSync(path.join(segDir, f));
        }
        fs.rmdirSync(segDir);
      }
    } catch (err) {
      if (err instanceof CancellationError) throw err;
      logger.error({ videoId, err }, "Video segmentation/embedding failed, continuing without embeddings");
    }

    checkCancellation(videoId);

    const thumbnailPath = framePaths[0] ? path.relative(FRAMES_DIR, framePaths[0]) : null;
    await db.update(videosTable).set({
      status: "completed",
      thumbnailPath,
    }).where(eq(videosTable.id, videoId));

    if (videoPath && fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
        logger.info({ videoId, videoPath }, "Cleaned up downloaded video file");
      } catch (cleanupErr) {
        logger.warn({ videoId, err: cleanupErr }, "Failed to clean up video file");
      }
    }

    cancelledVideoIds.delete(videoId);

    currentProcessingState.videoId = null;
    currentProcessingState.videoTitle = null;
    currentProcessingState.step = null;
    currentProcessingState.startedAt = null;
    currentProcessingState.stepStartedAt = null;
    currentProcessingState.current = null;
    currentProcessingState.total = null;
    currentProcessingState.bytesDownloaded = null;
    currentProcessingState.bytesTotal = null;

    logger.info({ videoId }, "Video processing completed");
  } catch (err) {
    currentProcessingState.videoId = null;
    currentProcessingState.videoTitle = null;
    currentProcessingState.step = null;
    currentProcessingState.startedAt = null;
    currentProcessingState.stepStartedAt = null;
    currentProcessingState.current = null;
    currentProcessingState.total = null;
    currentProcessingState.bytesDownloaded = null;
    currentProcessingState.bytesTotal = null;

    if (err instanceof CancellationError) {
      cancelledVideoIds.delete(videoId);
      await db.update(videosTable).set({ status: "cancelled" }).where(eq(videosTable.id, videoId));
      logger.info({ videoId }, "Video processing cancelled mid-pipeline");

      if (videoPath && fs.existsSync(videoPath)) {
        try { fs.unlinkSync(videoPath); } catch (_) {}
      }
      const localFramesDir = path.join(FRAMES_DIR, String(videoId));
      if (fs.existsSync(localFramesDir)) {
        try { fs.rmSync(localFramesDir, { recursive: true, force: true }); } catch (_) {}
      }
      const segDir = path.join(SEGMENTS_DIR, String(videoId));
      if (fs.existsSync(segDir)) {
        try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (_) {}
      }
      return;
    }

    logger.error({ videoId, err }, "Video processing failed");
    await db.update(videosTable).set({
      status: "failed",
      processingError: err instanceof Error ? err.message : String(err),
    }).where(eq(videosTable.id, videoId));

    if (videoPath && fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
        logger.info({ videoId }, "Cleaned up video file after failure");
      } catch (_) {}
    }
    const localFramesDir = path.join(FRAMES_DIR, String(videoId));
    if (fs.existsSync(localFramesDir)) {
      try { fs.rmSync(localFramesDir, { recursive: true, force: true }); } catch (_) {}
    }
    const segDir = path.join(SEGMENTS_DIR, String(videoId));
    if (fs.existsSync(segDir)) {
      try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (_) {}
    }

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
