# B-Roll Search App

## Overview

A semantic video search application that connects to Google Drive, processes videos (frame extraction, visual description, audio transcription), and enables natural-language search across video content. Built as a pnpm workspace monorepo using TypeScript.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM + Full-text search (tsvector)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI (via Replit AI Integrations) — GPT-4o Vision for frame descriptions, gpt-4o-mini-transcribe for audio transcription
- **Google Drive**: Replit Connectors SDK (`@replit/connectors-sdk`)
- **Video processing**: FFmpeg (frame extraction, audio extraction)

## Architecture

### Database Tables
- **videos** — Video metadata, Drive file ID, sync/processing status, duration
- **frames** — Extracted frames with timestamps, image paths, GPT-generated descriptions. GIN index on description tsvector for full-text search.
- **transcriptions** — Audio transcription segments with start/end timestamps. GIN index on content tsvector for full-text search.

### API Endpoints
- `GET /api/videos` — List all synced videos (optional status filter)
- `GET /api/videos/:id` — Video detail with frames and transcriptions
- `POST /api/videos/:id/process` — Trigger video processing pipeline
- `POST /api/videos/sync` — Sync videos from a Google Drive folder
- `GET /api/drive/folders` — List Google Drive folders
- `GET /api/drive/files?folderId=X` — List video files in a Drive folder
- `GET /api/search?q=X&type=all|visual|audio` — Full-text search across frames and transcriptions
- `GET /api/processing-status` — Processing queue overview
- `GET /api/frames/*` — Static file serving for extracted frame images
- `GET /api/folders` — List synced folders with video counts and status breakdown
- `DELETE /api/folders/:folderId` — Remove a folder and all its videos, frames, transcriptions, and local files
- `POST /api/folders/:folderId/sync` — Re-sync a folder to find new videos from Google Drive

### Processing Pipeline
1. Download video from Google Drive
2. Extract key frames with FFmpeg (1 frame per 5 seconds)
3. Send each frame to GPT-4o Vision for text description (batch processed, rate-limited)
4. Extract audio and transcribe with OpenAI Whisper
5. Store all results in PostgreSQL with full-text search indexes

### Key Directories
- `data/videos/` — Downloaded video files
- `data/frames/{videoId}/` — Extracted frame images per video

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

## Production Hardening

- **CORS**: Restricted to `CORS_ORIGIN` env var in production (blocks all cross-origin if unset); permissive in development. `trust proxy` enabled in production for correct client IP identification.
- **Rate Limiting**: `express-rate-limit` applied to expensive endpoints — search (30/min), sync (5/min), process (10/min)
- **Health Check**: `/api/healthz` verifies database connectivity before reporting healthy
- **Zombie Recovery**: Videos stuck in "processing" status are automatically reset to "pending" on server startup
- **Startup Validation**: All required environment variables (DATABASE_URL, OpenAI config) validated at boot with clear error messages
- **Log Level**: Configurable via `LOG_LEVEL` environment variable (already supported by pino logger)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
