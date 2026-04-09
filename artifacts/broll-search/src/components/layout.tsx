import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Film, Search, Settings, HardDrive, LayoutGrid, Loader2, LogOut } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/useAuth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const { user, logout } = useAuth();

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const navItems = [
    { href: "/", icon: Search, label: "Search" },
    { href: "/library", icon: Film, label: "Library" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground">
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-border">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
            <LayoutGrid size={18} />
          </div>
          <span className="font-bold tracking-tight text-lg">B-Roll Search</span>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}>
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        {user && (
          <div className="p-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <button
                onClick={logout}
                className="ml-2 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
        <div className="p-4 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${health ? "bg-green-500" : "bg-red-500"}`} />
            <span>{health ? "System Online" : "System Offline"}</span>
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
        {children}
      </main>
    </div>
  );
}
