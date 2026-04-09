import { useLocation } from "wouter";
import { useListVideos, useProcessVideo, useGetProcessingStatus } from "@workspace/api-client-react";
import { Loader2, RefreshCw, AlertCircle, CheckCircle2, Clock, MoreVertical, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDuration, formatBytes, formatDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListVideosQueryKey, getGetProcessingStatusQueryKey } from "@workspace/api-client-react";

export default function Library() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: status } = useGetProcessingStatus({
    query: {
      queryKey: getGetProcessingStatusQueryKey(),
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d && ((d.pending ?? 0) > 0 || (d.processing ?? 0) > 0)) return 3000;
        return false;
      },
    },
  });

  const hasActiveProcessing = (status?.pending ?? 0) > 0 || (status?.processing ?? 0) > 0;

  const { data: videos, isLoading } = useListVideos(undefined, {
    query: {
      queryKey: getListVideosQueryKey(),
      refetchInterval: hasActiveProcessing ? 5000 : false,
    },
  });
  
  const processMutation = useProcessVideo({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Processing Started",
          description: "Video has been added to the processing queue.",
        });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProcessingStatusQueryKey() });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to start video processing.",
        });
      }
    }
  });

  const handleProcess = (id: number) => {
    processMutation.mutate({ id });
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'completed': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'processing': return <Loader2 size={16} className="text-amber-500 animate-spin" />;
      case 'failed': return <AlertCircle size={16} className="text-red-500" />;
      default: return <Clock size={16} className="text-muted-foreground" />;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Video Library</h1>
            <p className="text-muted-foreground mt-1">Manage your synced videos and processing status.</p>
          </div>
          
          <Button onClick={() => setLocation("/settings")}>
            Sync from Drive
          </Button>
        </div>

        {/* Status Overview */}
        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-muted-foreground">Total</span>
              <span className="text-2xl font-bold">{status.total}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-green-500">Completed</span>
              <span className="text-2xl font-bold">{status.completed}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-amber-500">Processing</span>
              <span className="text-2xl font-bold">{status.processing}</span>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col justify-center">
              <span className="text-sm font-medium text-muted-foreground">Pending</span>
              <span className="text-2xl font-bold">{status.pending}</span>
            </div>
          </div>
        )}

        {/* Video Table */}
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
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <Loader2 className="animate-spin mx-auto text-muted-foreground" size={24} />
                  </TableCell>
                </TableRow>
              ) : !videos || videos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <p>No videos in library.</p>
                      <Button variant="link" onClick={() => setLocation("/settings")} className="mt-2">
                        Go to Settings to sync
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                videos.map(video => (
                  <TableRow 
                    key={video.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/videos/${video.id}`)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-8 rounded bg-muted overflow-hidden shrink-0">
                          {video.thumbnailPath ? (
                            <img src={`/api/frames/${video.thumbnailPath}`} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-zinc-900" />
                          )}
                        </div>
                        <div className="truncate max-w-[200px] md:max-w-md" title={video.title}>
                          {video.title}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(video.status)}
                        <span className="capitalize text-sm">{video.status}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">
                      {video.duration ? formatDuration(video.duration) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {video.fileSize ? formatBytes(video.fileSize) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatDate(video.createdAt)}
                    </TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setLocation(`/videos/${video.id}`)}>
                            <Play size={14} className="mr-2" /> View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleProcess(video.id)}>
                            <RefreshCw size={14} className="mr-2" /> 
                            {video.status === 'completed' ? 'Reprocess' : 'Process Now'}
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
      </div>
    </div>
  );
}
