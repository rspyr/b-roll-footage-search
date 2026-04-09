import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useSearchContent, getSearchContentQueryKey } from "@workspace/api-client-react";
import { Search as SearchIcon, Image as ImageIcon, Mic, Loader2, ArrowRight, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDuration } from "@/lib/format";

interface SearchResultItem {
  videoId: number;
  videoTitle: string;
  type: string;
  content: string;
  timestampSec: number;
  endSec?: number | null;
  imagePath?: string | null;
  rank: number;
}

function RelevanceBar({ rank, maxRank }: { rank: number; maxRank: number }) {
  const pct = maxRank > 0 ? Math.round((rank / maxRank) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <Sparkles size={12} className="text-amber-400 shrink-0" />
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400/80 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function SearchResults({
  results,
  total,
  query,
  onNavigate,
}: {
  results: SearchResultItem[];
  total: number;
  query: string;
  onNavigate: (path: string) => void;
}) {
  const maxRank = useMemo(() => {
    if (results.length === 0) return 0;
    return Math.max(...results.map(r => r.rank));
  }, [results]);

  return (
    <>
      <div className="text-sm text-muted-foreground">
        Found {total} results for &ldquo;{query}&rdquo;
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {results.map((result, i) => (
          <div 
            key={i} 
            className="flex flex-col rounded-lg border border-border bg-card overflow-hidden cursor-pointer hover:border-primary/50 transition-colors shadow-sm"
            onClick={() => onNavigate(`/videos/${result.videoId}?t=${result.timestampSec}`)}
          >
            <div className="aspect-video bg-muted relative">
              {result.imagePath ? (
                <img 
                  src={`/api/frames/${result.imagePath}`} 
                  alt="Video frame" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-muted-foreground">
                  <Mic size={32} opacity={0.3} />
                </div>
              )}
              
              <div className="absolute bottom-2 left-2 flex gap-2">
                <span className="bg-black/80 px-2 py-1 rounded text-xs font-mono text-white flex items-center gap-1">
                  {formatDuration(result.timestampSec)}
                  {result.endSec && ` - ${formatDuration(result.endSec)}`}
                </span>
              </div>
              
              <div className="absolute top-2 right-2">
                <span className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 shadow-sm
                  ${result.type === 'frame' ? 'bg-blue-500/90 text-white' : 'bg-purple-500/90 text-white'}`}>
                  {result.type === 'frame' ? <ImageIcon size={12}/> : <Mic size={12}/>}
                  {result.type === 'frame' ? 'Visual' : 'Audio'}
                </span>
              </div>
            </div>
            
            <div className="p-4 flex flex-col flex-1">
              <h3 className="font-medium text-sm truncate mb-2 text-primary hover:underline">{result.videoTitle}</h3>
              <p className="text-sm text-muted-foreground line-clamp-3 flex-1 italic">
                &ldquo;{result.content}&rdquo;
              </p>
              
              <div className="mt-3">
                <RelevanceBar rank={result.rank} maxRank={maxRank} />
              </div>
              
              <div className="mt-3 flex items-center text-xs font-medium text-muted-foreground hover:text-primary transition-colors group">
                View in context <ArrowRight size={14} className="ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default function SearchPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const q = searchParams.get("q") || "";
  const typeParam = searchParams.get("type") as "all" | "visual" | "audio" || "all";

  const [query, setQuery] = useState(q);
  const [type, setType] = useState<"all" | "visual" | "audio">(typeParam);
  
  // Update local state if URL changes
  useEffect(() => {
    setQuery(q);
    setType(typeParam);
  }, [q, typeParam]);

  const searchParams2 = { q, type: type === "all" ? undefined : type, limit: 50 };
  const { data: searchData, isLoading } = useSearchContent(
    searchParams2,
    { query: { enabled: !!q, queryKey: getSearchContentQueryKey(searchParams2) } }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      const newParams = new URLSearchParams();
      newParams.set("q", query.trim());
      if (type !== "all") newParams.set("type", type);
      setLocation(`/search?${newParams.toString()}`);
    }
  };

  const handleTypeChange = (newType: string) => {
    const newParams = new URLSearchParams(searchString);
    if (newType === "all") {
      newParams.delete("type");
    } else {
      newParams.set("type", newType);
    }
    setLocation(`/search?${newParams.toString()}`);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card p-4 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center gap-4">
          <form onSubmit={handleSearch} className="flex-1 relative flex items-center w-full">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..." 
              className="w-full pl-10 pr-4 bg-background"
            />
          </form>
          <Tabs value={type} onValueChange={handleTypeChange} className="w-full md:w-auto">
            <TabsList className="grid grid-cols-3 md:w-[300px]">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="visual"><ImageIcon size={14} className="mr-2"/> Visual</TabsTrigger>
              <TabsTrigger value="audio"><Mic size={14} className="mr-2"/> Audio</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          {!q ? (
            <div className="text-center py-20 text-muted-foreground">
              <SearchIcon size={48} className="mx-auto mb-4 opacity-20" />
              <h2 className="text-lg font-medium">Enter a search query</h2>
              <p>Find visual moments or spoken words in your videos.</p>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p>Searching for "{q}"...</p>
            </div>
          ) : searchData?.results.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed rounded-lg bg-card/50">
              <p>No results found for "{q}".</p>
            </div>
          ) : (
            <SearchResults
              results={searchData?.results || []}
              total={searchData?.total || 0}
              query={q}
              onNavigate={setLocation}
            />
          )}
        </div>
      </div>
    </div>
  );
}
