# Footage Search App

## Overview

A semantic video search application that connects to Google Drive, processes videos (frame extraction, visual description, audio transcription, video embedding), and enables hybrid semantic + keyword search across video content. Built as a pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM + Full-text search (tsvector) + pgvector (vector similarity search)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI — Frame Descriptions**: Gemini 2.5 Flash (`@google/genai` SDK with user's own `GEMINI_API_KEY`) for detailed multimodal frame analysis
- **AI — Video Embeddings**: Gemini Embedding 2 Preview (`gemini-embedding-2-preview`) for multimodal vector embeddings of video segments
- **AI — Audio Transcription**: OpenAI (via Replit AI Integrations) — gpt-4o-mini-transcribe for audio transcription
- **Vector Search**: pgvector extension with HNSW index for cosine similarity search
- **Google Drive**: Replit Connectors SDK (`@replit/connectors-sdk`)
- **Video processing**: FFmpeg (frame extraction, audio extraction, video segmentation)

## Architecture

### Database Tables
- **users** — User accounts with email (unique), name, bcrypt password hash, timestamps. Only `@hvaclaunch.ai` emails can register.
- **session** — Server-side session storage (connect-pg-simple). Auto-created on startup.
- **videos** — Video metadata, Drive file ID, sync/processing status, duration, AI-generated concept tags
- **frames** — Extracted frames with timestamps, image paths, Gemini-generated descriptions. GIN index on description tsvector for full-text search.
- **transcriptions** — Audio transcription segments with start/end timestamps. GIN index on content tsvector for full-text search.
- **video_segments** — Video segment embeddings for semantic vector search. Each row stores a segment's start/end timestamps and a 768-dimensional vector embedding from `gemini-embedding-2-preview`. HNSW index on embedding column for fast cosine similarity search.
- **search_feedback** — Thumbs up/down feedback on search results. Stacking design (multiple rows per user/video/query compound the effect). GIN index on query tsvector for FTS-based similarity matching during search.
- **video_annotations** — Free-text notes on videos that become an additional search channel. GIN indexes on content tsvector (FTS) and trigram (fuzzy). Adding an annotation also regenerates the video's AI concept tags.

### Authentication
- Custom email/password auth restricted to `@hvaclaunch.ai` domain
- Passwords hashed with bcrypt (12 rounds)
- Sessions stored in PostgreSQL via `express-session` + `connect-pg-simple`
- Session cookie: `connect.sid`, 7-day expiry, httpOnly
- `requireAuth` middleware protects all API routes except `/api/healthz` and `/api/auth/*`
- Frontend uses `AuthProvider` context with `useAuth` hook; unauthenticated users see login/register page
- User info and sign-out button displayed in sidebar

### API Endpoints
- `POST /api/auth/register` — Register (email, password, name); validates @hvaclaunch.ai domain
- `POST /api/auth/login` — Login with email/password, creates session
- `POST /api/auth/logout` — Destroy session
- `GET /api/auth/me` — Get current authenticated user
- `GET /api/videos` — List all synced videos (optional status filter)
- `GET /api/videos/:id` — Video detail with frames and transcriptions
- `POST /api/videos/:id/process` — Trigger video processing pipeline
- `POST /api/videos/:id/cancel` — Cancel a pending or processing video (immediately kills ffmpeg/download operations via AbortController, updates DB status, clears status bar, and restarts queue for next pending video)
- `POST /api/videos/sync` — Sync videos from a Google Drive folder
- `GET /api/drive/folders` — List Google Drive folders
- `GET /api/drive/files?folderId=X` — List video files in a Drive folder
- `GET /api/search?q=X&type=all|visual|audio` — Hybrid search (vector similarity + full-text search with RRF fusion)
- `GET /api/processing-status` — Processing queue overview
- `GET /api/frames/*` — Static file serving for extracted frame images
- `GET /api/folders` — List synced folders with video counts and status breakdown
- `DELETE /api/folders/:folderId` — Remove a folder and all its videos, frames, transcriptions, and local files
- `POST /api/folders/:folderId/sync` — Re-sync a folder to find new videos from Google Drive
- `PATCH /api/frames/:id` — Update a frame's description
- `POST /api/videos/:id/frames` — Add a manual frame description to a video
- `PATCH /api/transcriptions/:id` — Update a transcription segment's content
- `POST /api/videos/:id/transcriptions` — Add a manual transcription segment to a video
- `POST /api/videos/backfill-tags` — Generate AI concept tags for all completed videos missing tags (runs async in background)
- `POST /api/search/feedback` — Submit thumbs up/down feedback on a search result (stacking: repeated clicks compound the effect)
- `PATCH /api/videos/:id/tags` — Update a video's tags (comma-separated string, auto-normalized to lowercase)
- `GET /api/videos/:id/annotations` — List annotations for a video
- `POST /api/videos/:id/annotations` — Add an annotation note to a video (also regenerates AI tags and embeds annotations for vector search)
- `GET /api/annotations/status?videoIds=1,2,3` — Check which videos have annotations (returns map of videoId to count)

### Processing Pipeline
1. Download video from Google Drive
2. Extract key frames with FFmpeg (adaptive rate: 1 frame/2s for clips ≤30s, 1 frame/5s for longer)
3. Send frames to Gemini 2.5 Flash for detailed description with multi-frame temporal context (2-3 frames analyzed together)
4. Extract audio and transcribe with OpenAI Whisper
5. Segment video for embedding (≤120s: whole file; >120s: ~90s segments with 10s overlap)
6. Embed each video segment directly using `gemini-embedding-2-preview` (768-dim vectors)
7. Generate AI concept tags using Gemini 2.5 Flash (from title + frame descriptions + transcriptions)
8. Store all results in PostgreSQL with FTS indexes, trigram indexes, and pgvector HNSW index

### Search Architecture (Hybrid)
- **Query expansion**: User query is expanded by Gemini 2.5 Flash with synonyms/related terms before FTS (cached 10min)
- **Vector search**: Original user query is embedded via `gemini-embedding-2-preview`, then matched against video segment embeddings using pgvector cosine similarity (`<=>` operator)
- **Full-text search**: PostgreSQL `plainto_tsquery` with expanded query against frame descriptions, transcriptions, titles, and tags
- **Fuzzy matching**: `pg_trgm` word_similarity matching on titles, frame descriptions, and tags
- **Tag search**: AI-generated concept tags searched via FTS (4x boost) and fuzzy matching (3x)
- **Fusion**: Results from all sources combined using Reciprocal Rank Fusion (RRF), deduplicated by video, and ranked
- **Annotation search**: User-submitted notes on videos are searched via FTS (5x boost — highest weight) and fuzzy matching (3x boost). Adding annotations also embeds them as vectors (stored as video_segments with startSec=-1) for semantic search.
- **Feedback adjustment**: Thumbs up/down feedback applies proportional multipliers to RRF scores (each net downvote decays score by 30%; each net upvote boosts by 15%, clamped to 0.15–2.0x) using FTS similarity matching on stored queries
- **RRF boosts**: Annotation FTS (5x), Annotation fuzzy (4x), Tag FTS (4x), Title FTS (3x), Tag fuzzy (3x), Vector (2x), Title fuzzy (2x), Transcription FTS (1x), Frame Desc FTS (0.5x), Frame Desc fuzzy (0.5x)
- **GET /api/tags** — Returns all unique tags across all videos (used for tag autocomplete)
- This means "game" can find "Rock Paper Scissors.mp4" because concept tags capture abstract relationships

### Frame Storage (Object Storage)
- Extracted frame images are stored in **Replit Object Storage** (GCS-backed) for persistence across deployments
- Frames are uploaded during video processing and served via `/api/frames/{imagePath}` streamed from GCS
- Local frames are cleaned up after upload to object storage
- `frame-storage.ts` handles upload, streaming, and deletion of frames in GCS
- Bucket path: `frames/{videoId}/frame_XXXX.jpg`

### Key Directories
- `data/videos/` — Downloaded video files (temporary, re-downloadable from Drive)
- `data/segments/{videoId}/` — Temporary video segments for embedding (cleaned up after processing)

### Frontend (React + Vite)
- **Artifact**: `artifacts/broll-search` at preview path `/`
- **Framework**: React + Vite + Tailwind CSS + shadcn/ui
- **Routing**: Wouter (client-side)
- **Data fetching**: TanStack React Query + Orval-generated hooks from `@workspace/api-client-react`
- **Pages**:
  - `/` — Home with search bar, processing status dashboard, recently processed videos
  - `/search?q=X` — Search results grid with type filters (All/Visual/Audio)
  - `/videos/:id` — Video detail with frame timeline and transcription segments
  - `/library` — Folder-based video library with folder cards, status badges, remove/re-sync actions, and drill-down to folder videos
  - `/settings` — Google Drive folder browser and video sync

## Environment Variables & Secrets

- `DATABASE_URL` — PostgreSQL connection string (runtime managed)
- `GEMINI_API_KEY` — User's own Gemini API key for frame descriptions and video embeddings
- `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI via Replit AI Integrations for audio transcription
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — GCS bucket for frame storage (auto-provisioned)
- `PUBLIC_OBJECT_SEARCH_PATHS` / `PRIVATE_OBJECT_DIR` — Object storage paths (auto-provisioned)

## Production Hardening

- **CORS**: Restricted to `CORS_ORIGIN` env var in production (blocks all cross-origin if unset); permissive in development. `trust proxy` enabled in production for correct client IP identification.
- **Rate Limiting**: `express-rate-limit` applied to expensive endpoints — search (30/min), sync (5/min), process (10/min)
- **Health Check**: `/api/healthz` verifies database connectivity before reporting healthy
- **Auto Tag Backfill**: On every server startup (including production deploys), automatically generates AI concept tags for any completed videos missing them, incorporating annotations and neighbor-video tags from embedding similarity
- **Embedding Tag Propagation**: After backfill, uses vector embedding similarity to find related videos and propagate relevant tags between them — enriching search without re-processing video files
- **Zombie Recovery**: Videos stuck in "processing" status are automatically reset to "pending" on server startup
- **Startup Validation**: All required environment variables (DATABASE_URL, OpenAI config, GEMINI_API_KEY) validated at boot with clear error messages
- **Log Level**: Configurable via `LOG_LEVEL` environment variable (already supported by pino logger)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
