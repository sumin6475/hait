import { NavLink, Outlet } from "react-router-dom";
import {
  FlaskConical,
  LayoutDashboard,
  Settings2,
  Users,
  MessageSquare,
  BarChart3,
  ClipboardList,
  LogOut,
  Search,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "GENERAL",
    items: [
      { to: "/dashboard", icon: LayoutDashboard, label: "Overview", end: true },
      { to: "/dashboard/conditions", icon: Settings2, label: "Conditions" },
      { to: "/dashboard/sessions", icon: Users, label: "Sessions" },
      { to: "/dashboard/chat-logs", icon: MessageSquare, label: "Chat Logs" },
    ],
  },
  {
    label: "ANALYSIS",
    items: [
      { to: "/dashboard/analytics", icon: BarChart3, label: "Analytics" },
      { to: "/dashboard/surveys", icon: ClipboardList, label: "Surveys" },
    ],
  },
];

const DashboardLayout = () => (
  <div className="flex h-screen bg-background">
    <aside className="w-60 bg-sidebar flex flex-col border-r border-sidebar-border shrink-0">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <FlaskConical className="w-5 h-5 text-primary" />
        <span className="font-bold text-foreground text-[15px] tracking-tight">HAIT</span>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 mb-2 text-[11px] font-semibold text-muted-foreground tracking-widest">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="w-[18px] h-[18px]" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
            SK
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">Sumin Kim</div>
            <div className="text-xs text-muted-foreground truncate">Researcher</div>
          </div>
          <LogOut className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" />
        </div>
      </div>
    </aside>

    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-14 bg-sidebar border-b border-sidebar-border flex items-center justify-between px-6 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search"
            className="h-9 w-64 rounded-lg bg-background border-none pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
            ⌘+F
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button className="relative p-2 rounded-lg hover:bg-background transition-colors">
            <Bell className="w-[18px] h-[18px] text-muted-foreground" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  </div>
);

export default DashboardLayout;
