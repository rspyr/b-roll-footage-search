import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Film, Search, Settings, HardDrive, LayoutGrid, Loader2, LogOut, PanelLeftClose, PanelLeft } from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/useAuth";

const SidebarContext = createContext<{
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  collapse: () => void;
}>({ collapsed: false, setCollapsed: () => {}, collapse: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const collapse = useCallback(() => setCollapsed(true), []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const navItems = [
    { href: "/", icon: Search, label: "Search" },
    { href: "/library", icon: Film, label: "Library" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, collapse }}>
      <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground">
        <aside
          className={`border-r border-border bg-card flex flex-col shrink-0 transition-all duration-200 ${
            collapsed ? "w-full md:w-16" : "w-full md:w-64"
          }`}
        >
          <div className="h-14 flex items-center gap-3 border-b border-border px-4 shrink-0">
            {!collapsed && (
              <>
                <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                  <LayoutGrid size={18} />
                </div>
                <span className="font-bold tracking-tight text-lg flex-1">Footage Search</span>
              </>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md transition-colors text-sm font-medium ${
                    collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
                  } ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={18} />
                  {!collapsed && item.label}
                </Link>
              );
            })}
          </nav>
          {user && !collapsed && (
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
          {user && collapsed && (
            <div className="p-2 border-t border-border flex justify-center">
              <button
                onClick={logout}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
          <div className={`border-t border-border flex items-center text-xs text-muted-foreground ${
            collapsed ? "p-2 justify-center" : "p-4 justify-between"
          }`}>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${health ? "bg-green-500" : "bg-red-500"}`} />
              {!collapsed && <span>{health ? "System Online" : "System Offline"}</span>}
            </div>
          </div>
        </aside>
        <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden">
          {children}
        </main>
      </div>
    </SidebarContext.Provider>
  );
}
