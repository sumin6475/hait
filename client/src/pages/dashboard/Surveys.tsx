import { surveys, conditionLabel } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const Surveys = () => {
  const avgByCondition = (cond: string) => {
    const s = surveys.filter((sv) => sv.conditionCode === cond && sv.type === "trust");
    if (!s.length) return null;
    const vals = s.flatMap((sv) =>
      Object.values(sv.responses).filter((v): v is number => typeof v === "number"),
    );
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Survey Results</h1>
        <Button variant="outline" size="sm">
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Trust Score Averages by Condition
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {(["C1", "C2", "C3", "C4"] as const).map((code) => {
            const avg = avgByCondition(code);
            return (
              <div key={code} className="rounded-xl bg-card p-5 shadow-card text-center">
                <div className="text-xs text-muted-foreground">{conditionLabel[code]}</div>
                <div className="text-2xl font-bold mt-1">{avg || "—"}</div>
                <div className="text-xs text-muted-foreground mt-1">/ 5.0</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Individual Responses
        </h2>
        <div className="rounded-xl bg-card shadow-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Participant
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Condition
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Type
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Avg Score
                </th>
                <th className="text-left text-xs font-semibold text-muted-foreground uppercase px-5 py-3">
                  Completed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {surveys.map((sv) => {
                const vals = Object.values(sv.responses).filter(
                  (v): v is number => typeof v === "number",
                );
                const avg = vals.length
                  ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
                  : "—";
                return (
                  <tr key={sv.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3 font-mono text-sm">{sv.participantCode}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {conditionLabel[sv.conditionCode]}
                    </td>
                    <td className="px-5 py-3 text-sm capitalize">{sv.type.replace("_", " ")}</td>
                    <td className="px-5 py-3 text-sm font-medium">{avg}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {new Date(sv.completedAt).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Surveys;
