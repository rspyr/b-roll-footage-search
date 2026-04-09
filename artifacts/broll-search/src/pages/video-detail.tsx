import { useRoute, useSearch, Link } from "wouter";
import {
  useGetVideo,
  getGetVideoQueryKey,
  useProcessVideo,
  useUpdateFrameDescription,
  useAddManualFrame,
  useUpdateTranscriptionContent,
  useAddManualTranscription,
  getGetProcessingStatusQueryKey,
  getListVideosQueryKey,
  getListFoldersQueryKey,
} from "@workspace/api-client-react";
import {
  Loader2,
  ArrowLeft,
  Clock,
  FileVideo,
  HardDrive,
  AlertCircle,
  ExternalLink,
  Pencil,
  Check,
  X,
  Plus,
  RefreshCw,
} from "lucide-react";
import { formatDuration, formatBytes, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

function findNearestFrameTimestamp(
  frames: { timestampSec: number }[],
  target: number,
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
  target: number,
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

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: video,
    isLoading,
    error,
  } = useGetVideo(id, {
    query: { enabled: !!id, queryKey: getGetVideoQueryKey(id) },
  });

  const frameScrollRef = useRef<HTMLDivElement>(null);
  const transcriptionScrollRef = useRef<HTMLDivElement>(null);

  const [editingFrameId, setEditingFrameId] = useState<number | null>(null);
  const [editingFrameText, setEditingFrameText] = useState("");
  const [editingTransId, setEditingTransId] = useState<number | null>(null);
  const [editingTransText, setEditingTransText] = useState("");
  const [showAddFrame, setShowAddFrame] = useState(false);
  const [newFrameTs, setNewFrameTs] = useState("0");
  const [newFrameDesc, setNewFrameDesc] = useState("");
  const [showAddTrans, setShowAddTrans] = useState(false);
  const [newTransStart, setNewTransStart] = useState("0");
  const [newTransEnd, setNewTransEnd] = useState("1");
  const [newTransContent, setNewTransContent] = useState("");

  const invalidateVideo = () => {
    queryClient.invalidateQueries({ queryKey: getGetVideoQueryKey(id) });
  };

  const invalidateAll = () => {
    invalidateVideo();
    queryClient.invalidateQueries({ queryKey: getGetProcessingStatusQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
  };

  const reprocessMutation = useProcessVideo({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Processing Started",
          description: "Video has been added to the processing queue.",
        });
        invalidateAll();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to start video processing.",
        });
      },
    },
  });

  const updateFrameMutation = useUpdateFrameDescription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Description Updated" });
        setEditingFrameId(null);
        invalidateVideo();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update description.",
        });
      },
    },
  });

  const addFrameMutation = useAddManualFrame({
    mutation: {
      onSuccess: () => {
        toast({ title: "Description Added" });
        setShowAddFrame(false);
        setNewFrameTs("0");
        setNewFrameDesc("");
        invalidateVideo();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to add description.",
        });
      },
    },
  });

  const updateTransMutation = useUpdateTranscriptionContent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Transcription Updated" });
        setEditingTransId(null);
        invalidateVideo();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update transcription.",
        });
      },
    },
  });

  const addTransMutation = useAddManualTranscription({
    mutation: {
      onSuccess: () => {
        toast({ title: "Transcription Added" });
        setShowAddTrans(false);
        setNewTransStart("0");
        setNewTransEnd("1");
        setNewTransContent("");
        invalidateVideo();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to add transcription.",
        });
      },
    },
  });

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
        if (frameEl)
          frameEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      if (nearestTransTs !== null) {
        const transEl = document.getElementById(`trans-${nearestTransTs}`);
        if (transEl)
          transEl.scrollIntoView({ behavior: "smooth", block: "center" });
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
            <Link
              href="/library"
              className="flex items-center text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} className="mr-2" /> Back
            </Link>
          </Button>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {video.title}
              </h1>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock size={14} />{" "}
                  {video.duration
                    ? formatDuration(video.duration)
                    : "Unknown duration"}
                </span>
                <span className="flex items-center gap-1">
                  <FileVideo size={14} /> {video.mimeType}
                </span>
                {video.fileSize && (
                  <span className="flex items-center gap-1">
                    <HardDrive size={14} /> {formatBytes(video.fileSize)}
                  </span>
                )}
                <span>Added {formatDate(video.createdAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={reprocessMutation.isPending || video.status === "processing"}
                onClick={() => reprocessMutation.mutate({ id })}
              >
                {reprocessMutation.isPending ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="mr-1" />
                )}
                {video.status === "completed" ? "Reprocess" : "Process"}
              </Button>
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
              <Badge
                variant={
                  video.status === "completed"
                    ? "default"
                    : video.status === "failed"
                      ? "destructive"
                      : video.status === "processing"
                        ? "secondary"
                        : "outline"
                }
                className="capitalize"
              >
                {video.status}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-3 max-w-7xl mx-auto w-full p-4 gap-6">
        <div className="col-span-1 lg:col-span-2 flex flex-col bg-card rounded-lg border border-border overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 shrink-0 font-medium flex items-center justify-between">
            <span>Visual Timeline</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAddFrame(true)}
            >
              <Plus size={14} className="mr-1" /> Add Description
            </Button>
          </div>
          <ScrollArea className="flex-1 p-4" ref={frameScrollRef}>
            {showAddFrame && (
              <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/5 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    Timestamp (sec):
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={newFrameTs}
                    onChange={(e) => setNewFrameTs(e.target.value)}
                    className="h-7 w-24 text-sm"
                  />
                </div>
                <Textarea
                  value={newFrameDesc}
                  onChange={(e) => setNewFrameDesc(e.target.value)}
                  placeholder="Describe what happens at this timestamp..."
                  className="text-sm min-h-[60px]"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={
                      addFrameMutation.isPending || !newFrameDesc.trim()
                    }
                    onClick={() =>
                      addFrameMutation.mutate({
                        id,
                        data: {
                          timestampSec: parseFloat(newFrameTs) || 0,
                          description: newFrameDesc.trim(),
                        },
                      })
                    }
                  >
                    {addFrameMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin mr-1" />
                    ) : (
                      <Check size={12} className="mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setShowAddFrame(false);
                      setNewFrameDesc("");
                      setNewFrameTs("0");
                    }}
                  >
                    <X size={12} className="mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            )}
            {video.frames.length === 0 && !showAddFrame ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground italic gap-3">
                <p>
                  {video.status === "completed"
                    ? "No visual frames extracted."
                    : "Frames will appear here once processed."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddFrame(true)}
                >
                  <Plus size={14} className="mr-1" /> Add a description
                  manually
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {video.frames.map((frame) => (
                  <div
                    key={frame.id}
                    id={`frame-${frame.timestampSec}`}
                    className={`flex flex-col sm:flex-row gap-4 rounded-md p-2 transition-colors
                      ${isFrameHighlighted(frame.timestampSec) ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/50"}`}
                  >
                    <div className="sm:w-48 shrink-0 relative rounded overflow-hidden bg-muted aspect-video">
                      {frame.imagePath.startsWith("manual/") ? (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-muted-foreground text-xs">
                          <Pencil size={16} className="opacity-50" />
                        </div>
                      ) : (
                        <img
                          src={`/api/frames/${frame.imagePath}`}
                          alt={`Frame at ${formatDuration(frame.timestampSec)}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
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
                    <div className="flex-1 group/desc">
                      {editingFrameId === frame.id ? (
                        <div className="space-y-2">
                          <Textarea
                            value={editingFrameText}
                            onChange={(e) =>
                              setEditingFrameText(e.target.value)
                            }
                            className="text-sm min-h-[60px]"
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              disabled={updateFrameMutation.isPending}
                              onClick={() =>
                                updateFrameMutation.mutate({
                                  id: frame.id,
                                  data: { description: editingFrameText },
                                })
                              }
                            >
                              {updateFrameMutation.isPending ? (
                                <Loader2
                                  size={12}
                                  className="animate-spin mr-1"
                                />
                              ) : (
                                <Check size={12} className="mr-1" />
                              )}
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setEditingFrameId(null)}
                            >
                              <X size={12} className="mr-1" /> Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <p className="flex-1 text-sm text-muted-foreground italic">
                            {frame.description ||
                              "No visual description generated."}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 opacity-0 group-hover/desc:opacity-100 transition-opacity"
                            title="Edit description"
                            onClick={() => {
                              setEditingFrameId(frame.id);
                              setEditingFrameText(frame.description || "");
                            }}
                          >
                            <Pencil size={12} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="col-span-1 flex flex-col bg-card rounded-lg border border-border overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 shrink-0 font-medium flex items-center justify-between">
            <span>Spoken Content</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAddTrans(true)}
            >
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>
          <ScrollArea className="flex-1 p-4" ref={transcriptionScrollRef}>
            {showAddTrans && (
              <div className="mb-4 p-3 rounded-md border border-primary/30 bg-primary/5 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    Start (sec):
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={newTransStart}
                    onChange={(e) => setNewTransStart(e.target.value)}
                    className="h-7 w-20 text-sm"
                  />
                  <label className="text-xs text-muted-foreground whitespace-nowrap">
                    End:
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={newTransEnd}
                    onChange={(e) => setNewTransEnd(e.target.value)}
                    className="h-7 w-20 text-sm"
                  />
                </div>
                <Textarea
                  value={newTransContent}
                  onChange={(e) => setNewTransContent(e.target.value)}
                  placeholder="Enter the spoken content..."
                  className="text-sm min-h-[60px]"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={
                      addTransMutation.isPending || !newTransContent.trim()
                    }
                    onClick={() =>
                      addTransMutation.mutate({
                        id,
                        data: {
                          startSec: parseFloat(newTransStart) || 0,
                          endSec: parseFloat(newTransEnd) || 1,
                          content: newTransContent.trim(),
                        },
                      })
                    }
                  >
                    {addTransMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin mr-1" />
                    ) : (
                      <Check size={12} className="mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setShowAddTrans(false);
                      setNewTransContent("");
                      setNewTransStart("0");
                      setNewTransEnd("1");
                    }}
                  >
                    <X size={12} className="mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            )}
            {video.transcriptions.length === 0 && !showAddTrans ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground italic text-center px-4 gap-3">
                <p>
                  {video.status === "completed"
                    ? "No spoken content detected."
                    : "Transcription will appear here once processed."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddTrans(true)}
                >
                  <Plus size={14} className="mr-1" /> Add transcription
                  manually
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {video.transcriptions.map((trans) => (
                  <div
                    key={trans.id}
                    id={`trans-${trans.startSec}`}
                    className={`rounded-md p-3 border border-border/50 text-sm transition-colors group/trans
                      ${isTransHighlighted(trans.startSec, trans.endSec) ? "bg-primary/10 border-primary/30" : "bg-background hover:bg-accent/50"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <a
                        href={driveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary inline-flex items-center gap-1 hover:underline"
                        title={`Open in Drive (${formatDuration(trans.startSec)})`}
                      >
                        {formatDuration(trans.startSec)} -{" "}
                        {formatDuration(trans.endSec)}
                        <ExternalLink size={8} />
                      </a>
                      {editingTransId !== trans.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 opacity-0 group-hover/trans:opacity-100 transition-opacity"
                          title="Edit transcription"
                          onClick={() => {
                            setEditingTransId(trans.id);
                            setEditingTransText(trans.content);
                          }}
                        >
                          <Pencil size={12} />
                        </Button>
                      )}
                    </div>
                    {editingTransId === trans.id ? (
                      <div className="space-y-2 mt-2">
                        <Textarea
                          value={editingTransText}
                          onChange={(e) => setEditingTransText(e.target.value)}
                          className="text-sm min-h-[60px]"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={updateTransMutation.isPending}
                            onClick={() =>
                              updateTransMutation.mutate({
                                id: trans.id,
                                data: { content: editingTransText },
                              })
                            }
                          >
                            {updateTransMutation.isPending ? (
                              <Loader2
                                size={12}
                                className="animate-spin mr-1"
                              />
                            ) : (
                              <Check size={12} className="mr-1" />
                            )}
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditingTransId(null)}
                          >
                            <X size={12} className="mr-1" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-foreground leading-relaxed">
                        {trans.content}
                      </p>
                    )}
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
