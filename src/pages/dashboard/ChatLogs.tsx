import { useState } from "react";
import { sessions, messages, conditionLabel } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Download, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Filter = "all" | "humans" | "ai";

const ChatLogs = () => {
  const [selectedSession, setSelectedSession] = useState(sessions[0]?.id || "");
  const [filter, setFilter] = useState<Filter>("all");

  const sessionMessages = messages.filter((m) => m.sessionId === selectedSession);
  const filtered = filter === "all" ? sessionMessages :
    filter === "ai" ? sessionMessages.filter((m) => m.senderRole === "ai") :
    sessionMessages.filter((m) => m.senderRole !== "ai");

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chat Logs</h1>
        <Button variant="outline" size="sm"><Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV</Button>
      </div>

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Session</label>
          <div className="space-y-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSession(s.id)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                  selectedSession === s.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground"
                )}
              >
                <div className="font-mono">{s.sessionCode}</div>
                <div className="text-xs">{conditionLabel[s.conditionCode]}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div className="flex gap-2">
            {(["all", "humans", "ai"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {f === "all" ? "All" : f === "humans" ? "Humans Only" : "AI Only"}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-card shadow-card divide-y">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No messages found for this session</div>
            ) : (
              filtered.map((m) => (
                <div key={m.id} className="flex gap-4 px-5 py-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    m.senderRole === "ai" ? "bg-chat-ai" : "bg-muted"
                  )}>
                    {m.senderRole === "ai" ? <Bot className="w-4 h-4 text-chat-ai-badge" /> : <User className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.sender === "ai_alex" ? "AI Alex" : m.sender}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      {m.senderRole === "ai" && <span className="text-[10px] font-semibold text-chat-ai-badge bg-chat-ai rounded px-1.5 py-0.5">AI</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{m.content}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatLogs;
