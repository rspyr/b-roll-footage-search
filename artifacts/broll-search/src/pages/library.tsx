import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListVideos,
  useProcessVideo,
  useGetProcessingStatus,
  useListFolders,
  useRemoveFolder,
  useResyncFolder,
  getListVideosQueryKey,
  getGetProcessingStatusQueryKey,
  getListFoldersQueryKey,
} from "@workspace/api-client-react";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  MoreVertical,
  Play,
  FolderOpen,
  Trash2,
  ChevronLeft,
  FolderSync,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDuration, formatBytes, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Library() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderToRemove, setFolderToRemove] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data: status } = useGetProcessingStatus({
    query: {
      queryKey: getGetProcessingStatusQueryKey(),
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d && ((d.pending ?? 0) > 0 || (d.processing ?? 0) > 0))
          return 3000;
        return 30000;
      },
    },
  });

  const hasActiveProcessing =
    (status?.pending ?? 0) > 0 || (status?.processing ?? 0) > 0;

  const { data: folders, isLoading: foldersLoading } = useListFolders({
    query: {
      queryKey: getListFoldersQueryKey(),
      refetchInterval: hasActiveProcessing ? 5000 : 30000,
    },
  });

  const { data: videos, isLoading: videosLoading } = useListVideos(undefined, {
    query: {
      queryKey: getListVideosQueryKey(),
      refetchInterval: hasActiveProcessing ? 5000 : 30000,
      enabled: selectedFolderId !== null,
    },
  });

  const folderVideos = videos?.filter(
    (v) => v.driveFolderId === selectedFolderId,
  );

  const processMutation = useProcessVideo({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Processing Started",
          description: "Video has been added to the processing queue.",
        });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetProcessingStatusQueryKey(),
        });
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
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

  const removeMutation = useRemoveFolder({
    mutation: {
      onSuccess: (_data, { folderId }) => {
        toast({
          title: "Folder Removed",
          description: "Folder and all its videos have been removed.",
        });
        if (selectedFolderId === folderId) {
          setSelectedFolderId(null);
        }
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetProcessingStatusQueryKey(),
        });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to remove folder.",
        });
      },
    },
  });

  const resyncMutation = useResyncFolder({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Re-sync Complete",
          description:
            data.newVideoCount > 0
              ? `Found ${data.newVideoCount} new video${data.newVideoCount !== 1 ? "s" : ""}. Processing will start automatically.`
              : "No new videos found in this folder.",
        });
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetProcessingStatusQueryKey(),
        });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to re-sync folder.",
        });
      },
    },
  });

  const handleProcess = (id: number) => {
    processMutation.mutate({ id });
  };

  const getStatusIcon = (s: string) => {
    switch (s) {
      case "completed":
        return <CheckCircle2 size={16} className="text-green-500" />;
      case "processing":
        return <Loader2 size={16} className="text-amber-500 animate-spin" />;
      case "failed":
        return <AlertCircle size={16} className="text-red-500" />;
      default:
        return <Clock size={16} className="text-muted-foreground" />;
    }
  };

  const selectedFolder = folders?.find(
    (f) => f.driveFolderId === selectedFolderId,
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            {selectedFolderId ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedFolderId(null)}
                  className="h-8 w-8"
                >
                  <ChevronLeft size={20} />
                </Button>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">
                    {selectedFolder?.name ?? "Folder"}
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    {folderVideos?.length ?? 0} video
                    {(folderVideos?.length ?? 0) !== 1 ? "s" : ""} in this
                    folder
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-3xl font-bold tracking-tight">
                  Video Library
                </h1>
                <p className="text-muted-foreground mt-1">
                  Manage your synced folders and videos.
                </p>
              </div>
            )}
          </div>

          <Button onClick={() => setLocation("/settings")}>
            Sync from Drive
          </Button>
        </div>

        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-muted-foreground">
                Total
              </span>
              <span className="text-2xl font-bold">{status.total}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-green-500">
                Completed
              </span>
              <span className="text-2xl font-bold">{status.completed}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-amber-500">
                Processing
              </span>
              <span className="text-2xl font-bold">{status.processing}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-muted-foreground">
                Pending
              </span>
              <span className="text-2xl font-bold">{status.pending}</span>
            </div>
          </div>
        )}

        {selectedFolderId ? (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Video</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videosLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2
                        className="animate-spin mx-auto text-muted-foreground"
                        size={24}
                      />
                    </TableCell>
                  </TableRow>
                ) : !folderVideos || folderVideos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <p>No videos in this folder.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  folderVideos.map((video) => (
                    <TableRow
                      key={video.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setLocation(`/videos/${video.id}`)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-8 rounded bg-muted overflow-hidden shrink-0">
                            {video.thumbnailPath ? (
                              <img
                                src={`/api/frames/${video.thumbnailPath}`}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-zinc-900" />
                            )}
                          </div>
                          <div
                            className="truncate max-w-[200px] md:max-w-md"
                            title={video.title}
                          >
                            {video.title}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(video.status)}
                          <span className="capitalize text-sm">
                            {video.status}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {video.duration ? formatDuration(video.duration) : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {video.fileSize ? formatBytes(video.fileSize) : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {formatDate(video.createdAt)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                            >
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setLocation(`/videos/${video.id}`)
                              }
                            >
                              <Play size={14} className="mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleProcess(video.id)}
                            >
                              <RefreshCw size={14} className="mr-2" />
                              {video.status === "completed"
                                ? "Reprocess"
                                : "Process Now"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {foldersLoading ? (
              <div className="col-span-full flex justify-center py-16">
                <Loader2
                  className="animate-spin text-muted-foreground"
                  size={24}
                />
              </div>
            ) : !folders || folders.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FolderOpen size={48} className="mb-4 opacity-50" />
                <p className="text-lg font-medium">No folders synced yet</p>
                <Button
                  variant="link"
                  onClick={() => setLocation("/settings")}
                  className="mt-2"
                >
                  Go to Settings to sync a folder
                </Button>
              </div>
            ) : (
              folders.map((folder) => (
                <div
                  key={folder.driveFolderId}
                  className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-colors cursor-pointer group"
                  onClick={() => setSelectedFolderId(folder.driveFolderId)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="bg-primary/10 text-primary rounded-lg p-2 shrink-0">
                        <FolderOpen size={20} />
                      </div>
                      <h3
                        className="font-semibold text-lg truncate"
                        title={folder.name}
                      >
                        {folder.name}
                      </h3>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              resyncMutation.mutate({
                                folderId: folder.driveFolderId,
                              })
                            }
                            disabled={resyncMutation.isPending}
                          >
                            <FolderSync size={14} className="mr-2" />
                            Re-sync
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() =>
                              setFolderToRemove({
                                id: folder.driveFolderId,
                                name: folder.name,
                              })
                            }
                          >
                            <Trash2 size={14} className="mr-2" />
                            Remove Folder
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-4">
                    {folder.videoCount} video
                    {folder.videoCount !== 1 ? "s" : ""}
                  </p>

                  <div className="flex items-center gap-3 text-xs">
                    {folder.completedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-green-500/10 text-green-500 hover:bg-green-500/20"
                      >
                        <CheckCircle2 size={12} className="mr-1" />
                        {folder.completedCount}
                      </Badge>
                    )}
                    {folder.processingCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                      >
                        <Loader2 size={12} className="mr-1 animate-spin" />
                        {folder.processingCount}
                      </Badge>
                    )}
                    {folder.pendingCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-muted text-muted-foreground"
                      >
                        <Clock size={12} className="mr-1" />
                        {folder.pendingCount}
                      </Badge>
                    )}
                    {folder.failedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-red-500/10 text-red-500 hover:bg-red-500/20"
                      >
                        <AlertCircle size={12} className="mr-1" />
                        {folder.failedCount}
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={folderToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setFolderToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Folder</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove "{folderToRemove?.name}" and all its
              videos, frames, and transcriptions from the app. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (folderToRemove) {
                  removeMutation.mutate({ folderId: folderToRemove.id });
                  setFolderToRemove(null);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
