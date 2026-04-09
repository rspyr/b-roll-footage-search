import { useState } from "react";
import { useListDriveFolders, useListDriveFiles, useSyncVideos, getListVideosQueryKey, getGetProcessingStatusQueryKey } from "@workspace/api-client-react";
import { Folder, HardDrive, ChevronRight, CheckCircle, Loader2, PlayCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [folderHistory, setFolderHistory] = useState<{id: string | undefined, name: string}[]>([{id: undefined, name: "Root"}]);
  const currentFolderId = folderHistory[folderHistory.length - 1].id;

  const { data: folders, isLoading: isLoadingFolders } = useListDriveFolders({ parentId: currentFolderId });
  const { data: files, isLoading: isLoadingFiles } = useListDriveFiles(
    { folderId: currentFolderId as string }, 
    { query: { enabled: !!currentFolderId } }
  );

  const syncMutation = useSyncVideos({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "Sync Successful",
          description: `Added ${data.syncedCount} new videos to the library. Processing will begin automatically.`,
        });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProcessingStatusQueryKey() });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Sync Failed",
          description: "There was an error syncing videos from Google Drive.",
        });
      }
    }
  });

  const navigateToFolder = (id: string, name: string) => {
    setFolderHistory([...folderHistory, { id, name }]);
  };

  const navigateUpTo = (index: number) => {
    setFolderHistory(folderHistory.slice(0, index + 1));
  };

  const handleSync = () => {
    if (!currentFolderId) return;
    syncMutation.mutate({ data: { folderId: currentFolderId } });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings & Integrations</h1>
          <p className="text-muted-foreground mt-1">Connect your data sources to B-Roll Search.</p>
        </div>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="text-primary"/> Google Drive</CardTitle>
            <CardDescription>
              Select a folder containing your video files to sync and process. Supported formats: MP4, MOV, WEBM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-1 p-2 bg-muted/50 rounded-md border border-border text-sm overflow-x-auto whitespace-nowrap">
              {folderHistory.map((folder, index) => (
                <div key={index} className="flex items-center">
                  <button 
                    onClick={() => navigateUpTo(index)}
                    className={`hover:text-primary hover:underline ${index === folderHistory.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {folder.name}
                  </button>
                  {index < folderHistory.length - 1 && <ChevronRight size={14} className="mx-1 text-muted-foreground/50" />}
                </div>
              ))}
            </div>

            {/* Folder Browser */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-[400px]">
              
              {/* Folders */}
              <div className="border border-border rounded-lg flex flex-col bg-card overflow-hidden">
                <div className="p-3 border-b border-border bg-muted/30 font-medium text-sm">Folders</div>
                <ScrollArea className="flex-1">
                  {isLoadingFolders ? (
                    <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
                  ) : folders?.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm italic">No folders found</div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {folders?.map(folder => (
                        <button
                          key={folder.id}
                          onClick={() => navigateToFolder(folder.id, folder.name)}
                          className="w-full flex items-center justify-between p-3 hover:bg-accent transition-colors text-left"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <Folder size={18} className="text-primary shrink-0" />
                            <span className="truncate text-sm">{folder.name}</span>
                          </div>
                          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {/* Files in selected folder */}
              <div className="border border-border rounded-lg flex flex-col bg-card overflow-hidden">
                <div className="p-3 border-b border-border bg-muted/30 font-medium text-sm">
                  Video Files {files?.length ? `(${files.length})` : ''}
                </div>
                <ScrollArea className="flex-1">
                  {!currentFolderId ? (
                    <div className="h-full flex items-center justify-center p-8 text-center text-muted-foreground text-sm">
                      Select a folder to view videos
                    </div>
                  ) : isLoadingFiles ? (
                    <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
                  ) : files?.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm italic">No video files found</div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {files?.map(file => (
                        <div key={file.id} className="w-full flex items-center p-3 text-left">
                          <PlayCircle size={18} className="text-muted-foreground shrink-0 mr-3" />
                          <div className="flex-1 overflow-hidden">
                            <div className="truncate text-sm font-medium">{file.name}</div>
                            {file.size && <div className="text-xs text-muted-foreground font-mono">{formatBytes(parseInt(file.size))}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </div>

          </CardContent>
          <CardFooter className="border-t border-border p-4 bg-muted/20 flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {files?.length ? `Found ${files.length} videos ready to sync.` : 'Select a folder containing videos.'}
            </div>
            <Button 
              onClick={handleSync} 
              disabled={!currentFolderId || !files?.length || syncMutation.isPending}
            >
              {syncMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sync Folder Videos
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
