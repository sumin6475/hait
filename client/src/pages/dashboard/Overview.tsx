import { useSessionList } from "@/hooks/useSessions";
import { CONDITION_CODES, conditionLabel } from "@/lib/conditions";
import {
  Activity,
  Users,
  CheckCircle,
  Clock,
  Circle,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";

const statusIcon = (s: string) => {
  if (s === "completed" || s === "data_ready")
    return <CheckCircle className="w-3.5 h-3.5 text-status-success" />;
  if (s === "in_progress") return <Activity className="w-3.5 h-3.5 text-status-warning" />;
  return <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />;
};

const Overview = () => {
  const { data: sessions = [], isLoading, error } = useSessionList();
  const condCodes = CONDITION_CODES;

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Failed to load sessions</div>;

  const realSessions = sessions.filter((s) => s.isTest === false || s.sessionCode.startsWith("S-"));
  const stats = condCodes.map((code) => {
    const s = realSessions.filter((s) => s.conditionCode === code);
    return {
      code,
      label: conditionLabel[code],
      completed: s.filter((s) => s.status === "completed" || s.status === "data_ready").length,
      inProgress: s.filter((s) => s.status === "in_progress").length,
      waiting: s.filter((s) => s.status === "waiting").length,
      total: 5,
    };
  });

  const condProgress = stats.map((s) => ({
    condition: s.code,
    completed: s.completed,
    remaining: s.total - s.completed,
  }));

  const totalParticipants = realSessions.reduce((a, s) => a + s.participantCount, 0);
  const completedSessions = realSessions.filter(
    (s) => s.status === "completed" || s.status === "data_ready",
  ).length;

  //평균 duration: startedAt~endedAt 차이 (분)
  const completedWithTimes = sessions.filter((s) => s.startedAt && s.endedAt);
  const avgDurationMin = completedWithTimes.length
    ? Math.round(
        completedWithTimes.reduce((a, s) => {
          const start = new Date(s.startedAt!).getTime();
          const end = new Date(s.endedAt!).getTime();
          return a + (end - start);
        }, 0) /
          completedWithTimes.length /
          60_000,
      )
    : 0;

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor experiment progress across all conditions
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Updated: Today</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="rounded-xl bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span>Total Participants</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="w-4 h-4 text-primary" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{totalParticipants}</span>
            <span className="flex items-center gap-1 text-xs font-medium text-status-success bg-status-success/10 px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" /> -%
            </span>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4" />
              <span>Completed Sessions</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-brand-teal/10 flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-brand-teal" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{completedSessions}</span>
            <span className="text-sm text-muted-foreground font-medium">/ {sessions.length}</span>
          </div>
        </div>

        <div className="rounded-xl bg-card p-6 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>Avg Duration</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-brand-blue/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-brand-blue" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{avgDurationMin}</span>
            <span className="text-sm text-muted-foreground font-medium">min</span>
            <span className="flex items-center gap-1 text-xs font-medium text-status-success bg-status-success/10 px-2 py-0.5 rounded-full">
              <TrendingUp className="w-3 h-3" /> -%
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 rounded-xl bg-card p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Session Progress</h3>
            <div className="flex gap-2">
              <button className="text-xs px-3 py-1.5 rounded-lg border bg-background text-muted-foreground hover:text-foreground transition-colors">
                Filter
              </button>
              <button className="text-xs px-3 py-1.5 rounded-lg border bg-background text-muted-foreground hover:text-foreground transition-colors">
                Sort
              </button>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={condProgress} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="condition"
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 5]}
                  ticks={[0, 1, 2, 3, 4, 5]}
                />
                <Tooltip />
                <ReferenceLine
                  y={5}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="6 4"
                  strokeOpacity={0.5}
                  label={{
                    value: "target: 5 teams",
                    position: "right",
                    fontSize: 10,
                    fill: "hsl(var(--muted-foreground))",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="completed"
                  stackId="a"
                  fill="hsl(var(--brand-purple))"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="remaining"
                  stackId="a"
                  fill="hsl(var(--brand-purple-light))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="col-span-2 rounded-xl bg-card p-6 shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Conditions</h3>
          </div>
          <div className="space-y-3">
            {stats.map((s) => (
              <div key={s.code} className="flex items-center gap-3">
                <span className="font-mono font-bold text-xs w-10 text-primary">{s.code}</span>
                <div className="flex-1">
                  <div className="flex gap-1 h-2">
                    {Array.from({ length: s.total }).map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-full",
                          i < s.completed
                            ? "bg-brand-purple"
                            : i < s.completed + s.inProgress
                              ? "bg-brand-blue"
                              : "bg-muted",
                        )}
                      />
                    ))}
                  </div>
                </div>
                <span className="text-xs font-semibold text-foreground w-8 text-right">
                  {s.completed}/{s.total}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-card shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-sm font-semibold">Recent Sessions</h3>
          <button className="text-xs text-primary font-semibold hover:underline">See All</button>
        </div>
        <div className="divide-y">
          {sessions.slice(0, 5).map((s) => (
            <div
              key={s.sessionCode}
              className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              {statusIcon(s.status)}
              <span className="font-mono text-sm font-medium w-24">{s.sessionCode}</span>
              <span className="text-sm text-muted-foreground flex-1">
                {conditionLabel[s.conditionCode]}
              </span>
              {s.startedAt && (
                <span className="text-xs text-muted-foreground w-20 text-right">
                  {new Date(s.startedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              <span
                className={cn(
                  "text-xs font-medium px-2.5 py-1 rounded-full",
                  s.status === "completed" && "bg-status-success/10 text-status-success",
                  s.status === "data_ready" && "bg-status-success/10 text-status-success",
                  s.status === "in_progress" && "bg-status-warning/10 text-status-warning",
                  s.status === "waiting" && "bg-muted text-muted-foreground",
                )}
              >
                {s.status.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Overview;
