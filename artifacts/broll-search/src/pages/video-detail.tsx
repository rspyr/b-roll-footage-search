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
  getSearchContentQueryKey,
  useGetVideoAnnotations,
  useAddVideoAnnotation,
  getGetVideoAnnotationsQueryKey,
  useUpdateVideoTags,
  useListAllTags,
  getListAllTagsQueryKey,
} from "@workspace/api-client-react";
import type { AnnotationItem } from "@workspace/api-client-react";
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
  MessageSquare,
  Send,
  Tag,
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
  const urlParams = new URLSearchParams(searchString);
  const timestamp = urlParams.get("t");
  const targetTs = timestamp ? parseFloat(timestamp) : null;
  const fromParam = urlParams.get("from");
  const backHref = fromParam || "/library";
  const backLabel = fromParam?.startsWith("/search") ? "Back to results" : "Back";

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
  const [newAnnotation, setNewAnnotation] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [tagsText, setTagsText] = useState("");
  const [newTag, setNewTag] = useState("");
  const [tagSuggestionIdx, setTagSuggestionIdx] = useState(-1);
  const [showAddFrame, setShowAddFrame] = useState(false);
  const [newFrameTs, setNewFrameTs] = useState("0");
  const [newFrameDesc, setNewFrameDesc] = useState("");
  const [showAddTrans, setShowAddTrans] = useState(false);
  const [newTransStart, setNewTransStart] = useState("0");
  const [newTransEnd, setNewTransEnd] = useState("1");
  const [newTransContent, setNewTransContent] = useState("");

  const invalidateVideo = () => {
    queryClient.invalidateQueries({ queryKey: getGetVideoQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getSearchContentQueryKey() });
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

  const { data: annotations } = useGetVideoAnnotations(id, {
    query: { enabled: !!id, queryKey: getGetVideoAnnotationsQueryKey(id) },
  });

  const addAnnotationMutation = useAddVideoAnnotation({
    mutation: {
      onSuccess: () => {
        toast({ title: "Note Added" });
        setNewAnnotation("");
        queryClient.invalidateQueries({ queryKey: getGetVideoAnnotationsQueryKey(id) });
        invalidateVideo();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to add note.",
        });
      },
    },
  });

  const updateTagsMutation = useUpdateVideoTags({
    mutation: {
      onSuccess: () => {
        toast({ title: "Tags Updated" });
        setEditingTags(false);
        setNewTag("");
        invalidateVideo();
        queryClient.invalidateQueries({ queryKey: getListAllTagsQueryKey() });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to update tags.",
        });
      },
    },
  });

  const { data: allTagsList } = useListAllTags();

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
              href={backHref}
              className="flex items-center text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} className="mr-2" /> {backLabel}
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

      <div className="max-w-7xl mx-auto w-full px-4 pt-4">
        <div className="bg-card rounded-lg border border-border overflow-visible">
          <div className="p-3 border-b border-border bg-muted/30 font-medium flex items-center gap-2 rounded-t-lg">
            <Tag size={16} />
            <span>Tags</span>
            {!editingTags && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs ml-auto"
                onClick={() => {
                  setEditingTags(true);
                  setTagsText(video.tags || "");
                }}
              >
                <Pencil size={12} className="mr-1" /> Edit All
              </Button>
            )}
          </div>
          <div className="p-3">
            {editingTags ? (
              <div className="space-y-2">
                <Textarea
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="Enter comma-separated tags..."
                  className="text-sm min-h-[60px]"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={updateTagsMutation.isPending}
                    onClick={() =>
                      updateTagsMutation.mutate({
                        id,
                        data: { tags: tagsText },
                      })
                    }
                  >
                    {updateTagsMutation.isPending ? (
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
                    onClick={() => setEditingTags(false)}
                  >
                    <X size={12} className="mr-1" /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {video.tags ? (
                    video.tags.split(",").map((tag: string, i: number) => {
                      const trimmed = tag.trim();
                      if (!trimmed) return null;
                      return (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="text-xs font-normal pr-1 flex items-center gap-1 group"
                        >
                          {trimmed}
                          <button
                            className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              const tags = (video.tags || "")
                                .split(",")
                                .map((t: string) => t.trim().toLowerCase())
                                .filter(Boolean);
                              const updated = tags.filter((_: string, idx: number) => idx !== i).join(", ");
                              updateTagsMutation.mutate({ id, data: { tags: updated } });
                            }}
                          >
                            <X size={10} />
                          </button>
                        </Badge>
                      );
                    })
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No tags yet. Tags are created automatically during processing, or add your own below.
                    </p>
                  )}
                </div>
                <div className="relative mt-2">
                  {(() => {
                    const currentTags = new Set(
                      (video.tags || "").split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean)
                    );
                    const suggestions = newTag.trim().length > 0 && allTagsList
                      ? allTagsList.filter(
                          (t: string) =>
                            t.includes(newTag.trim().toLowerCase()) &&
                            !currentTags.has(t)
                        ).slice(0, 10)
                      : [];

                    const addTag = (tagToAdd: string) => {
                      const existing = video.tags || "";
                      const trimmed = tagToAdd.trim().toLowerCase();
                      if (!trimmed || currentTags.has(trimmed)) {
                        setNewTag("");
                        setTagSuggestionIdx(-1);
                        return;
                      }
                      const updated = existing ? `${existing}, ${trimmed}` : trimmed;
                      updateTagsMutation.mutate({ id, data: { tags: updated } });
                      setTagSuggestionIdx(-1);
                    };

                    return (
                      <>
                        <div className="flex gap-2">
                          <Input
                            value={newTag}
                            onChange={(e) => {
                              setNewTag(e.target.value);
                              setTagSuggestionIdx(-1);
                            }}
                            placeholder="Add a tag..."
                            className="h-7 text-sm flex-1"
                            onKeyDown={(e) => {
                              if (e.key === "ArrowDown") {
                                e.preventDefault();
                                setTagSuggestionIdx((prev) =>
                                  suggestions.length > 0 ? Math.min(prev + 1, suggestions.length - 1) : -1
                                );
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                setTagSuggestionIdx((prev) => Math.max(prev - 1, -1));
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                if (tagSuggestionIdx >= 0 && tagSuggestionIdx < suggestions.length) {
                                  addTag(suggestions[tagSuggestionIdx]);
                                } else if (newTag.trim()) {
                                  addTag(newTag);
                                }
                              } else if (e.key === "Escape") {
                                setNewTag("");
                                setTagSuggestionIdx(-1);
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={!newTag.trim() || updateTagsMutation.isPending}
                            onClick={() => addTag(newTag)}
                          >
                            <Plus size={12} className="mr-1" /> Add
                          </Button>
                        </div>
                        {suggestions.length > 0 && (
                          <div className="absolute left-0 right-12 top-8 z-[9999] bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                            {suggestions.map((suggestion: string, idx: number) => (
                              <button
                                key={suggestion}
                                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                                  idx === tagSuggestionIdx ? "bg-accent" : "hover:bg-accent"
                                }`}
                                onClick={() => {
                                  addTag(suggestion);
                                }}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </>
            )}
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
                  className="text-sm min-h-[144px]"
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
                            className="text-sm min-h-[144px]"
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
                  className="text-sm min-h-[144px]"
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
                          className="text-sm min-h-[144px]"
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

      <div className="max-w-7xl mx-auto w-full px-4 pb-4">
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <div className="p-3 border-b border-border bg-muted/30 font-medium flex items-center gap-2">
            <MessageSquare size={16} />
            <span>Search Notes</span>
            {annotations && annotations.length > 0 && (
              <Badge variant="secondary" className="text-xs">{annotations.length}</Badge>
            )}
          </div>
          <div className="p-4 space-y-3">
            {annotations && annotations.length > 0 ? (
              <div className="space-y-2">
                {annotations.map((a: AnnotationItem) => (
                  <div key={a.id} className="text-sm text-foreground bg-muted/50 rounded-md px-3 py-2 border border-border/50">
                    {a.content}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(a.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No notes yet. Add notes to help the search engine find this video better.
              </p>
            )}
            <div className="flex gap-2">
              <Textarea
                value={newAnnotation}
                onChange={(e) => setNewAnnotation(e.target.value)}
                placeholder="Add a note (e.g. 'good for nature scenes', 'not useful for interviews')..."
                className="text-sm min-h-[72px] flex-1 resize-none"
              />
              <Button
                size="sm"
                className="self-end"
                disabled={!newAnnotation.trim() || addAnnotationMutation.isPending}
                onClick={() => addAnnotationMutation.mutate({ id, data: { content: newAnnotation.trim() } })}
              >
                {addAnnotationMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin mr-1" />
                ) : (
                  <Send size={14} className="mr-1" />
                )}
                Add Note
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
