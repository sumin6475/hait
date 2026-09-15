//세션 목록 탭 (All / Main / Test) — Sessions, Chat Logs 페이지 공용
//분류 기준은 @/lib/sessionView

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SessionSummary } from "@/lib/api";
import { parseSessionView, SESSION_VIEWS, sessionsInView, type SessionView } from "@/lib/sessionView";

export function SessionViewTabs({
  view,
  onChange,
  sessions,
}: {
  view: SessionView;
  onChange: (next: SessionView) => void;
  //목록을 아직 못 받았으면 개수를 숨긴다
  sessions?: SessionSummary[];
}) {
  return (
    <Tabs value={view} onValueChange={(v) => onChange(parseSessionView(v))}>
      <TabsList>
        {SESSION_VIEWS.map((v) => (
          <TabsTrigger key={v.value} value={v.value}>
            {v.label}
            {sessions && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {sessionsInView(sessions, v.value).length}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
