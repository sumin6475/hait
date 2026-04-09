import { sessions, conditionLabel } from "@/lib/mockData";
import { cn } from "@/lib/utils";

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    completed: "bg-status-success/10 text-status-success",
    data_ready: "bg-status-success/10 text-status-success",
    in_progress: "bg-status-warning/10 text-status-warning",
    waiting: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("text-xs font-medium px-2.5 py-0.5 rounded-full", styles[status] || styles.waiting)}>
      {status.replace("_", " ")}
    </span>
  );
};

const Sessions = () => (
  <div className="p-8 space-y-6">
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <button className="text-sm text-primary hover:underline font-medium">Generate Codes</button>
    </div>

    <div className="rounded-xl bg-card shadow-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Session</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Condition</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Status</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Participants</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Started</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Duration</th>
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-muted/20 cursor-pointer transition-colors">
              <td className="px-5 py-3 font-mono text-sm font-medium">{s.sessionCode}</td>
              <td className="px-5 py-3 text-sm text-muted-foreground">{conditionLabel[s.conditionCode]}</td>
              <td className="px-5 py-3">{statusBadge(s.status)}</td>
              <td className="px-5 py-3 text-sm">{s.participants.length}/{s.conditionCode === "CTRL" ? 3 : 2}</td>
              <td className="px-5 py-3 text-sm text-muted-foreground">
                {s.startedAt ? new Date(s.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
              <td className="px-5 py-3 text-sm text-muted-foreground">
                {s.metadata?.durationSeconds ? `${Math.round(s.metadata.durationSeconds / 60)} min` : "—"}
              </td>
              <td className="px-5 py-3">
                {s.teamDecision ? (
                  <span className={cn("font-mono font-bold text-sm", s.teamDecision === "C" ? "text-status-success" : "text-destructive")}>{s.teamDecision}</span>
                ) : <span className="text-muted-foreground">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default Sessions;
