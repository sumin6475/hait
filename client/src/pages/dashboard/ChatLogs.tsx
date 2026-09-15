import { useState } from "react";
import { useSessionList, useSessionDetail } from "@/hooks/useSessions";
import { conditionLabel } from "@/lib/conditions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionViewTabs } from "@/components/dashboard/SessionViewTabs";
import { useSessionView } from "@/hooks/useSessionView";
import { sessionsInView } from "@/lib/sessionView";
import { getSession, type ConditionCode, type SessionDetail } from "@/lib/api";
import { toCsv, downloadCsv, fileStamp, type CsvColumn } from "@/lib/csv";

type Filter = "all" | "humans" | "ai";

type ChatMessage = SessionDetail["messages"][number];
//CSV 한 행 = 메시지 하나 + 어느 세션 것인지 (전체 내보내기에서 세션이 섞이므로 필수)
type CsvRow = ChatMessage & { sessionCode: string; conditionCode: ConditionCode };

const CSV_COLUMNS: CsvColumn<CsvRow>[] = [
  { header: "session_code", value: (r) => r.sessionCode },
  { header: "condition_code", value: (r) => r.conditionCode },
  { header: "condition_label", value: (r) => conditionLabel[r.conditionCode] },
  { header: "seq", value: (r) => r.seq },
  { header: "sender", value: (r) => r.sender },
  { header: "sender_role", value: (r) => r.senderRole },
  { header: "is_ai", value: (r) => (r.senderRole === "ai" ? 1 : 0) },
  //ISO(UTC) — 분석 스크립트가 파싱하기 쉬운 형태로 고정
  { header: "created_at", value: (r) => new Date(r.createdAt).toISOString() },
  { header: "content", value: (r) => r.content },
];

//화면 필터를 CSV에도 그대로 적용 (보고 있는 것 = 내려받는 것)
function applyFilter(messages: ChatMessage[], filter: Filter): ChatMessage[] {
  if (filter === "all") return messages;
  return filter === "ai"
    ? messages.filter((m) => m.senderRole === "ai")
    : messages.filter((m) => m.senderRole !== "ai");
}

const ChatLogs = () => {
  const { data: sessions = [], isSuccess: sessionsLoaded } = useSessionList();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [exporting, setExporting] = useState(false);
  //세션 탭 (All / Main / Test) — Sessions 페이지와 같은 기준, 주소의 ?view= 에 유지
  const [view, setView] = useSessionView();
  const visibleSessions = sessionsInView(sessions, view);

  //고른 세션이 지금 탭에 없으면(선택 전이거나 탭을 바꿨으면) 탭의 첫 세션을 보여준다
  const activeCode =
    (selectedCode && visibleSessions.some((s) => s.sessionCode === selectedCode)
      ? selectedCode
      : visibleSessions[0]?.sessionCode) ?? null;
  //선택된 세션의 상세(메시지 포함) - in_progress면 3초마다 자동 갱신
  const { data: detail } = useSessionDetail(activeCode ?? undefined);

  const sessionMessages = detail?.messages ?? [];
  const filtered = applyFilter(sessionMessages, filter);

  const filterSuffix = filter === "all" ? "" : `_${filter}`;

  //현재 세션 — 이미 받아둔 메시지를 그대로 쓴다 (추가 요청 없음)
  const exportCurrent = () => {
    if (!detail) return;
    const rows: CsvRow[] = filtered.map((m) => ({
      ...m,
      sessionCode: detail.session.sessionCode,
      conditionCode: detail.session.conditionCode,
    }));
    downloadCsv(
      `chatlogs_${detail.session.sessionCode}${filterSuffix}_${fileStamp()}.csv`,
      toCsv(rows, CSV_COLUMNS),
    );
  };

  //지금 탭의 세션 전부 (보고 있는 탭 = 내려받는 범위) — 세션마다 상세를 받아야 하므로 4개씩 끊어서 호출 (서버 과부하 방지)
  const exportAll = async () => {
    setExporting(true);
    try {
      const rows: CsvRow[] = [];
      for (let i = 0; i < visibleSessions.length; i += 4) {
        const batch = await Promise.all(
          visibleSessions.slice(i, i + 4).map((s) =>
            getSession(s.sessionCode).catch((e) => {
              console.error(`[chatlogs] export failed: ${s.sessionCode}`, e);
              return null;
            }),
          ),
        );
        for (const d of batch) {
          if (!d) continue;
          for (const m of applyFilter(d.messages, filter)) {
            rows.push({
              ...m,
              sessionCode: d.session.sessionCode,
              conditionCode: d.session.conditionCode,
            });
          }
        }
      }
      downloadCsv(`chatlogs_${view}${filterSuffix}_${fileStamp()}.csv`, toCsv(rows, CSV_COLUMNS));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Chat Logs</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={exporting || visibleSessions.length === 0}>
              <Download className="w-3.5 h-3.5 mr-1.5" />
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportCurrent} disabled={filtered.length === 0}>
              This session ({filtered.length} messages)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportAll}>
              {view === "all" ? "All sessions" : `All ${view} sessions`} ({visibleSessions.length})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <SessionViewTabs view={view} onChange={setView} sessions={sessionsLoaded ? sessions : undefined} />

      <div className="flex gap-6">
        <div className="w-56 shrink-0 space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Session</label>
          <div className="space-y-1">
            {visibleSessions.map((s) => (
              <button
                key={s.sessionCode}
                onClick={() => setSelectedCode(s.sessionCode)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-colors",
                  activeCode === s.sessionCode
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-muted-foreground",
                )}
              >
                <div className="font-mono">{s.sessionCode}</div>
                <div className="text-xs">{conditionLabel[s.conditionCode]}</div>
              </button>
            ))}
            {sessionsLoaded && visibleSessions.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {view === "all" ? "No sessions yet" : `No ${view} sessions yet`}
              </div>
            )}
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
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {f === "all" ? "All" : f === "humans" ? "Humans Only" : "AI Only"}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-card shadow-card divide-y">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No messages found for this session
              </div>
            ) : (
              filtered.map((m) => (
                <div key={m.seq} className="flex gap-4 px-5 py-3">
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      m.senderRole === "ai" ? "bg-chat-ai" : "bg-muted",
                    )}
                  >
                    {m.senderRole === "ai" ? (
                      <Bot className="w-4 h-4 text-chat-ai-badge" />
                    ) : (
                      <User className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {m.senderRole === "ai" ? "AI Alex" : m.sender}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      {m.senderRole === "ai" && (
                        <span className="text-[10px] font-semibold text-chat-ai-badge bg-chat-ai rounded px-1.5 py-0.5">
                          AI
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                      {m.content}
                    </p>
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
