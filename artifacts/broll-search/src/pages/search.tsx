import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useSearchContent, getSearchContentQueryKey } from "@workspace/api-client-react";
import { Search as SearchIcon, Image as ImageIcon, Mic, Loader2, ArrowRight, Sparkles, Link as LinkIcon, Check, Info } from "lucide-react";
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
  driveFileId?: string | null;
  allFramePaths?: string[];
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

function HoverScrubThumbnail({
  imagePath,
  allFramePaths,
  type,
}: {
  imagePath?: string | null;
  allFramePaths?: string[];
  type: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const frames = allFramePaths && allFramePaths.length > 0 ? allFramePaths : [];

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (frames.length < 2) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const idx = Math.min(Math.floor(pct * frames.length), frames.length - 1);
      setScrubIndex(idx);
    },
    [frames.length]
  );

  const handleMouseLeave = useCallback(() => {
    setScrubIndex(null);
  }, []);

  const displayPath =
    scrubIndex !== null && frames.length > 0
      ? frames[scrubIndex]
      : imagePath;

  const hasImage = displayPath && !displayPath.startsWith("manual/");

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {hasImage ? (
        <img
          src={`/api/frames/${displayPath}`}
          alt="Video frame"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-muted-foreground">
          <Mic size={32} opacity={0.3} />
        </div>
      )}
      {scrubIndex !== null && frames.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
          <div
            className="h-full bg-white/80 transition-[width] duration-75"
            style={{ width: `${((scrubIndex + 1) / frames.length) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function CopyDriveLinkButton({ driveFileId }: { driveFileId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const url = `https://drive.google.com/file/d/${driveFileId}/view`;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [driveFileId]
  );

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
      title={copied ? "Copied!" : "Copy Drive link"}
    >
      {copied ? <Check size={14} /> : <LinkIcon size={14} />}
    </button>
  );
}

function SearchResults({
  results,
  total,
  query,
  onNavigate,
  searchString,
}: {
  results: SearchResultItem[];
  total: number;
  query: string;
  onNavigate: (path: string) => void;
  searchString: string;
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
            onClick={() => {
              if (result.driveFileId) {
                window.open(`https://drive.google.com/file/d/${result.driveFileId}/view`, '_blank', 'noopener,noreferrer');
              } else {
                const searchUrl = "/search" + (searchString.startsWith("?") ? searchString : `?${searchString}`);
                onNavigate(`/videos/${result.videoId}?t=${result.timestampSec}&from=${encodeURIComponent(searchUrl)}`);
              }
            }}
          >
            <div className="aspect-video bg-muted relative">
              <HoverScrubThumbnail
                imagePath={result.imagePath}
                allFramePaths={result.allFramePaths}
                type={result.type}
              />
              
              <div className="absolute bottom-2 left-2 flex gap-2">
                <span className="bg-black/80 px-2 py-1 rounded text-xs font-mono text-white flex items-center gap-1">
                  {formatDuration(result.timestampSec)}
                  {result.endSec && ` - ${formatDuration(result.endSec)}`}
                </span>
              </div>
              
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {result.driveFileId && (
                  <CopyDriveLinkButton driveFileId={result.driveFileId} />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const searchUrl = "/search" + (searchString.startsWith("?") ? searchString : `?${searchString}`);
                    onNavigate(`/videos/${result.videoId}?t=${result.timestampSec}&from=${encodeURIComponent(searchUrl)}`);
                  }}
                  className="p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white transition-colors"
                  title="View details"
                >
                  <Info size={14} />
                </button>
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
              
              <div className="mt-3 flex items-center text-xs font-medium text-muted-foreground hover:text-primary transition-colors group"
                onClick={(e) => {
                  e.stopPropagation();
                  const searchUrl = "/search" + (searchString.startsWith("?") ? searchString : `?${searchString}`);
                  onNavigate(`/videos/${result.videoId}?t=${result.timestampSec}&from=${encodeURIComponent(searchUrl)}`);
                }}
              >
                View details <ArrowRight size={14} className="ml-1 group-hover:translate-x-1 transition-transform" />
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    setQuery(q);
    setType(typeParam);
  }, [q, typeParam]);

  const searchParams2 = { q, type: type === "all" ? undefined : type, limit: 50 };
  const { data: searchData, isLoading, isFetching } = useSearchContent(
    searchParams2,
    { query: { enabled: !!q, queryKey: getSearchContentQueryKey(searchParams2) } }
  );

  useEffect(() => {
    if (searchData && !hasLoadedOnce) {
      setHasLoadedOnce(true);
    }
  }, [searchData, hasLoadedOnce]);

  const updateUrl = useCallback((value: string, currentType: "all" | "visual" | "audio") => {
    const trimmed = value.trim();
    if (trimmed) {
      const newParams = new URLSearchParams();
      newParams.set("q", trimmed);
      if (currentType !== "all") newParams.set("type", currentType);
      setLocation(`/search?${newParams.toString()}`);
    } else {
      setLocation("/search");
    }
  }, [setLocation]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateUrl(value, type);
    }, 350);
  }, [type, updateUrl]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    updateUrl(query, type);
  };

  const handleTypeChange = (newType: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    const castType = newType as "all" | "visual" | "audio";
    setType(castType);
    if (trimmed) {
      const newParams = new URLSearchParams();
      newParams.set("q", trimmed);
      if (castType !== "all") newParams.set("type", castType);
      setLocation(`/search?${newParams.toString()}`);
    }
  };

  const hasResults = searchData && searchData.results.length > 0;
  const showFullSpinner = isLoading && !hasLoadedOnce;
  const showInlineLoading = isFetching && hasLoadedOnce && !showFullSpinner;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-card p-4 shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center gap-4">
          <form onSubmit={handleSearch} className="flex-1 relative flex items-center w-full">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input 
              value={query}
              onChange={handleInputChange}
              placeholder="Search..." 
              className="w-full pl-10 pr-10 bg-background"
            />
            {showInlineLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" size={16} />
            )}
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
          {!q && !query.trim() ? (
            <div className="text-center py-20 text-muted-foreground">
              <SearchIcon size={48} className="mx-auto mb-4 opacity-20" />
              <h2 className="text-lg font-medium">Enter a search query</h2>
              <p>Find visual moments or spoken words in your videos.</p>
            </div>
          ) : showFullSpinner ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p>Searching for &ldquo;{q}&rdquo;...</p>
            </div>
          ) : q && !isFetching && searchData?.results.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground border border-dashed rounded-lg bg-card/50">
              <p>No results found for &ldquo;{q}&rdquo;.</p>
            </div>
          ) : hasResults ? (
            <SearchResults
              results={searchData?.results || []}
              total={searchData?.total || 0}
              query={q}
              onNavigate={setLocation}
              searchString={searchString}
            />
          ) : isFetching ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="animate-spin" size={18} />
              <p className="text-sm">Searching&hellip;</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
