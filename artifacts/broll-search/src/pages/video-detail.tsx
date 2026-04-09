import { useRoute, useSearch, Link } from "wouter";
import { useGetVideo, getGetVideoQueryKey } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Clock, FileVideo, HardDrive, AlertCircle, ExternalLink } from "lucide-react";
import { formatDuration, formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

function findNearestFrameTimestamp(
  frames: { timestampSec: number }[],
  target: number
): number | null {
  if (frames.length === 0) return null;
  let nearest = frames[0].timestampSec;
  let minDiff = Math.abs(nearest - target);
  for (const f of frames) {
    const diff = Math.abs(f.timestampSec - target);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = f.timestampSec;
    }
  }
  return nearest;
}

function findNearestTranscriptionStart(
  transcriptions: { startSec: number; endSec: number }[],
  target: number
): number | null {
  for (const t of transcriptions) {
    if (target >= t.startSec && target <= t.endSec) return t.startSec;
  }
  if (transcriptions.length === 0) return null;
  let nearest = transcriptions[0].startSec;
  let minDiff = Math.abs(nearest - target);
  for (const t of transcriptions) {
    const diff = Math.abs(t.startSec - target);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = t.startSec;
    }
  }
  return nearest;
}

export default function VideoDetail() {
  const [, params] = useRoute("/videos/:id");
  const id = params?.id ? parseInt(params.id) : 0;
  
  const searchString = useSearch();
  const timestamp = new URLSearchParams(searchString).get("t");
  const targetTs = timestamp ? parseFloat(timestamp) : null;
  
  const { data: video, isLoading, error } = useGetVideo(id, { query: { enabled: !!id, queryKey: getGetVideoQueryKey(id) } });
  
  const frameScrollRef = useRef<HTMLDivElement>(null);
  const transcriptionScrollRef = useRef<HTMLDivElement>(null);

  const nearestFrameTs = useMemo(() => {
    if (targetTs === null || !video) return null;
    return findNearestFrameTimestamp(video.frames, targetTs);
  }, [targetTs, video]);

  const nearestTransTs = useMemo(() => {
    if (targetTs === null || !video) return null;
    return findNearestTranscriptionStart(video.transcriptions, targetTs);
  }, [targetTs, video]);

  useEffect(() => {
    if (targetTs === null || !video || isLoading) return;
    
    setTimeout(() => {
      if (nearestFrameTs !== null) {
        const frameEl = document.getElementById(`frame-${nearestFrameTs}`);
        if (frameEl) frameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      
      if (nearestTransTs !== null) {
        const transEl = document.getElementById(`trans-${nearestTransTs}`);
        if (transEl) transEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 500);
  }, [targetTs, video, isLoading, nearestFrameTs, nearestTransTs]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" size={32} />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
        <AlertCircle size={48} className="text-destructive opacity-50" />
        <h2 className="text-xl font-bold">Video not found</h2>
        <Button asChild variant="outline">
          <Link href="/library">Back to Library</Link>
        </Button>
      </div>
    );
  }

  const isFrameHighlighted = (frameTs: number) => {
    if (nearestFrameTs === null) return false;
    return frameTs === nearestFrameTs;
  };

  const isTransHighlighted = (startSec: number, endSec: number) => {
    if (targetTs === null) return false;
    if (targetTs >= startSec && targetTs <= endSec) return true;
    return nearestTransTs === startSec;
  };

  const driveUrl = `https://drive.google.com/file/d/${video.driveFileId}/view`;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card p-4 shrink-0">
        <div className="max-w-7xl mx-auto">
          <Button asChild variant="ghost" size="sm" className="mb-4">
            <Link href="/library" className="flex items-center text-muted-foreground hover:text-foreground">
              <ArrowLeft size={16} className="mr-2" /> Back
            </Link>
          </Button>
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{video.title}</h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Clock size={14}/> {video.duration ? formatDuration(video.duration) : "Unknown duration"}</span>
                <span className="flex items-center gap-1"><FileVideo size={14}/> {video.mimeType}</span>
                {video.fileSize && <span className="flex items-center gap-1"><HardDrive size={14}/> {formatBytes(video.fileSize)}</span>}
                <span>Added {formatDate(video.createdAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button asChild variant="outline" size="sm">
                <a
                  href={driveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <ExternalLink size={14} />
                  Open in Drive
                </a>
              </Button>
              <Badge variant={
                video.status === 'completed' ? 'default' : 
                video.status === 'failed' ? 'destructive' : 
                video.status === 'processing' ? 'secondary' : 'outline'
              } className="capitalize">
                {video.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-3 max-w-7xl mx-auto w-full p-4 gap-6">
        <div className="col-span-1 lg:col-span-2 flex flex-col bg-card rounded-lg border border-border overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 shrink-0 font-medium">Visual Timeline</div>
          <ScrollArea className="flex-1 p-4" ref={frameScrollRef}>
            {video.frames.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground italic">
                {video.status === 'completed' ? "No visual frames extracted." : "Frames will appear here once processed."}
              </div>
            ) : (
              <div className="space-y-4">
                {video.frames.map(frame => (
                  <div 
                    key={frame.id} 
                    id={`frame-${frame.timestampSec}`}
                    className={`flex flex-col sm:flex-row gap-4 rounded-md p-2 transition-colors
                      ${isFrameHighlighted(frame.timestampSec) ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent/50'}`}
                  >
                    <div className="sm:w-48 shrink-0 relative rounded overflow-hidden bg-muted aspect-video">
                      <img 
                        src={`/api/frames/${frame.imagePath}`} 
                        alt={`Frame at ${formatDuration(frame.timestampSec)}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <a
                        href={driveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[10px] font-mono text-white hover:bg-primary/80 transition-colors flex items-center gap-1"
                        title={`Open in Drive (${formatDuration(frame.timestampSec)})`}
                      >
                        {formatDuration(frame.timestampSec)}
                        <ExternalLink size={8} />
                      </a>
                    </div>
                    <div className="flex-1 text-sm text-muted-foreground italic">
                      {frame.description || "No visual description generated."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="col-span-1 flex flex-col bg-card rounded-lg border border-border overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 shrink-0 font-medium">Spoken Content</div>
          <ScrollArea className="flex-1 p-4" ref={transcriptionScrollRef}>
            {video.transcriptions.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground italic text-center px-4">
                {video.status === 'completed' ? "No spoken content detected." : "Transcription will appear here once processed."}
              </div>
            ) : (
              <div className="space-y-4">
                {video.transcriptions.map(trans => (
                  <div 
                    key={trans.id}
                    id={`trans-${trans.startSec}`} 
                    className={`rounded-md p-3 border border-border/50 text-sm transition-colors
                      ${isTransHighlighted(trans.startSec, trans.endSec) ? 'bg-primary/10 border-primary/30' : 'bg-background hover:bg-accent/50'}`}
                  >
                    <a
                      href={driveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-primary mb-1 inline-flex items-center gap-1 hover:underline"
                      title={`Open in Drive (${formatDuration(trans.startSec)})`}
                    >
                      {formatDuration(trans.startSec)} - {formatDuration(trans.endSec)}
                      <ExternalLink size={8} />
                    </a>
                    <p className="text-foreground leading-relaxed">{trans.content}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
