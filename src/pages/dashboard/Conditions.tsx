import { useState } from "react";
import { conditions, conditionLabel } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Save, Play, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConditionCode } from "@/types";

const matrix: [ConditionCode, ConditionCode][] = [["C1", "C2"], ["C3", "C4"]];

const Conditions = () => {
  const [selected, setSelected] = useState<ConditionCode>("C1");
  const cond = conditions.find((c) => c.code === selected)!;
  const [prompt, setPrompt] = useState(cond.systemPrompt);

  const handleSelect = (code: ConditionCode) => {
    setSelected(code);
    const c = conditions.find((c) => c.code === code)!;
    setPrompt(c.systemPrompt);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-3">
        <Settings2 className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-semibold">Condition Manager</h1>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-center">
          <div />
          <div className="text-xs font-semibold text-muted-foreground uppercase">Peer AI</div>
          <div className="text-xs font-semibold text-muted-foreground uppercase">Leader AI</div>
        </div>
        {(["XAI", "ACI"] as const).map((strat, ri) => (
          <div key={strat} className="grid grid-cols-[120px_1fr_1fr] gap-2">
            <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">{strat} Strategy</div>
            {matrix[ri].map((code) => (
              <button
                key={code}
                onClick={() => handleSelect(code)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-all",
                  selected === code ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-input hover:border-primary/40"
                )}
              >
                <div className="font-mono font-bold text-sm">{code}</div>
                <div className="text-xs text-muted-foreground mt-1">{conditionLabel[code]}</div>
                <div className="text-xs text-muted-foreground/60 mt-1">v{conditions.find((c) => c.code === code)?.version}</div>
              </button>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">Control</div>
          <button
            onClick={() => handleSelect("CTRL")}
            className={cn(
              "rounded-lg border p-4 text-left transition-all",
              selected === "CTRL" ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-input hover:border-primary/40"
            )}
          >
            <div className="font-mono font-bold text-sm">CTRL</div>
            <div className="text-xs text-muted-foreground mt-1">3-human team, no AI</div>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">System Prompt — {selected}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm"><Play className="w-3.5 h-3.5 mr-1.5" /> Test Chat</Button>
            <Button size="sm"><Save className="w-3.5 h-3.5 mr-1.5" /> Save v{(cond.version || 0) + 1}</Button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-64 rounded-lg border border-input bg-background px-4 py-3 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {cond.leaderScripts && (
        <div className="space-y-3">
          <h2 className="font-medium">Leader Intervention Scripts</h2>
          <div className="grid gap-3">
            {Object.entries(cond.leaderScripts).map(([key, val]) => (
              <div key={key} className="rounded-lg border p-4 space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{key.replace(/([A-Z])/g, " $1").trim()}</label>
                <textarea
                  defaultValue={val}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Conditions;
