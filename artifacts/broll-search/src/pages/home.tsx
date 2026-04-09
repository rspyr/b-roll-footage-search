import { useState } from "react";
import { useLocation } from "wouter";
import { Search, PlayCircle, HardDrive, Loader2, Video } from "lucide-react";
import { useGetProcessingStatus, useListVideos } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";

export default function Home() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: status } = useGetProcessingStatus();
  const { data: videos, isLoading } = useListVideos({ status: "completed" });

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8 space-y-12">
        <div className="flex flex-col items-center text-center space-y-6 py-12">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Find the exact moment.</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Search through your video library's visual frames and spoken content using natural language.
          </p>
          
          <form onSubmit={handleSearch} className="w-full max-w-2xl relative flex items-center">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
            <Input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for 'drone shot of city' or spoken words..." 
              className="w-full pl-12 pr-24 py-6 text-lg rounded-xl bg-card border-border shadow-sm"
            />
            <Button type="submit" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2 h-9">
              Search
            </Button>
          </form>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card">
            <CardHeader className="py-4 px-5 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Video size={16} /> Total Library
              </CardTitle>
            </CardHeader>
            <CardContent className="py-4 px-5">
              <div className="text-2xl font-bold">{status?.total || 0} videos</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardHeader className="py-4 px-5 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-500">
                <PlayCircle size={16} /> Ready
              </CardTitle>
            </CardHeader>
            <CardContent className="py-4 px-5">
              <div className="text-2xl font-bold">{status?.completed || 0} processed</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardHeader className="py-4 px-5 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
                <Loader2 size={16} className="animate-spin" /> Processing
              </CardTitle>
            </CardHeader>
            <CardContent className="py-4 px-5">
              <div className="text-2xl font-bold">{status?.processing || 0} active</div>
            </CardContent>
          </Card>
          <Card className="bg-card">
            <CardHeader className="py-4 px-5 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                <HardDrive size={16} /> Pending
              </CardTitle>
            </CardHeader>
            <CardContent className="py-4 px-5">
              <div className="text-2xl font-bold">{status?.pending || 0} queued</div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">Recently Processed</h2>
          {isLoading ? (
            <div className="flex justify-center p-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : videos?.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-lg bg-card/50">
              <p className="text-muted-foreground">No videos processed yet.</p>
              <Button variant="link" onClick={() => setLocation("/settings")} className="mt-2">Connect Google Drive to sync videos</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos?.slice(0, 6).map(video => (
                <div key={video.id} className="group cursor-pointer rounded-lg overflow-hidden border border-border bg-card hover:border-primary/50 transition-all shadow-sm" onClick={() => setLocation(`/videos/${video.id}`)}>
                  <div className="aspect-video bg-muted relative overflow-hidden">
                    {video.thumbnailPath ? (
                      <img src={`/api/frames/${video.thumbnailPath}`} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Video size={32} opacity={0.5} />
                      </div>
                    )}
                    {video.duration && (
                      <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-mono text-white">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium truncate text-sm" title={video.title}>{video.title}</h3>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
