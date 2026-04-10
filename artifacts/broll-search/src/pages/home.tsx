import { useState } from "react";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setLocation(`/search?q=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
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
              placeholder="Search for 'furnace panel'..." 
              className="w-full pl-12 pr-24 py-6 text-lg rounded-xl bg-card border-border shadow-sm"
            />
            <Button type="submit" size="sm" className="absolute right-2 top-1/2 -translate-y-1/2 h-9">
              Search
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
