import { useState } from "react";
import { conditions, conditionLabel } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { Save, Play, Settings2, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConditionCode } from "@/types";

const matrix: [ConditionCode, ConditionCode][] = [
  ["C1", "C2"],
  ["C3", "C4"],
];

const timingLabels: Record<string, string> = {
  opening: "t = 0:00",
  transition: "after each candidate",
  midCheck: "t ≈ 10:00",
  turnAssignment: "as needed",
  finalPrompt: "t ≈ 18:00",
};

const scriptLabels: Record<string, string> = {
  opening: "Opening",
  transition: "Candidate Transitions",
  midCheck: "Mid Check",
  turnAssignment: "Turn Assignment",
  finalPrompt: "Final Prompt",
};

const getCleanPrompt = (raw: string) => {
  const idx = raw.indexOf("BEHAVIOR RULES — 5 INTERVENTION POINTS");
  if (idx === -1) return raw;
  return raw.substring(0, idx).replace(/\n+$/, "");
};

const Conditions = () => {
  const [selected, setSelected] = useState<ConditionCode>("C1");
  const cond = conditions.find((c) => c.code === selected)!;
  const [prompt, setPrompt] = useState(getCleanPrompt(cond.systemPrompt));
  const [testOpen, setTestOpen] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  const handleSelect = (code: ConditionCode) => {
    setSelected(code);
    const c = conditions.find((c) => c.code === code)!;
    setPrompt(getCleanPrompt(c.systemPrompt));
  };

  const isLeader = cond.status === "leader";

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center gap-3">
        <Settings2 className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-semibold">Condition Manager</h1>
      </div>

      {/* Condition Matrix Card */}
      <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-center">
          <div />
          <div className="text-xs font-semibold text-muted-foreground uppercase">Peer AI</div>
          <div className="text-xs font-semibold text-muted-foreground uppercase">Leader AI</div>
        </div>
        {(["XAI", "ACI"] as const).map((strat, ri) => (
          <div key={strat} className="grid grid-cols-[120px_1fr_1fr] gap-2">
            <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
              {strat} Strategy
            </div>
            {matrix[ri].map((code) => (
              <button
                key={code}
                onClick={() => handleSelect(code)}
                className={cn(
                  "rounded-lg border-2 p-4 text-left transition-all",
                  selected === code
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                    : "border-input hover:border-primary/40",
                )}
              >
                <div className="font-mono font-bold text-sm">{code}</div>
                <div className="text-xs text-muted-foreground mt-1">{conditionLabel[code]}</div>
                <div className="text-xs text-muted-foreground/60 mt-1">
                  v{conditions.find((c) => c.code === code)?.version}
                </div>
              </button>
            ))}
          </div>
        ))}
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <div className="flex items-center justify-center text-xs font-semibold text-muted-foreground uppercase">
            Control
          </div>
          <button
            onClick={() => handleSelect("CTRL")}
            className={cn(
              "rounded-lg border-2 p-4 text-left transition-all",
              selected === "CTRL"
                ? "border-primary bg-primary/10 ring-2 ring-primary/30 shadow-md"
                : "border-input hover:border-primary/40",
            )}
          >
            <div className="font-mono font-bold text-sm">CTRL</div>
            <div className="text-xs text-muted-foreground mt-1">3-human team, no AI</div>
          </button>
        </div>
      </div>

      {/* System Prompt Card */}
      <div className="rounded-xl border bg-card p-6 shadow-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">System Prompt — {selected}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
              <Play className="w-3.5 h-3.5 mr-1.5" /> Test Chat
            </Button>
            <Button size="sm">
              <Save className="w-3.5 h-3.5 mr-1.5" /> Save v{(cond.version || 0) + 1}
            </Button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full h-64 rounded-lg border border-input bg-background px-4 py-3 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Leader Intervention Scripts */}
      {isLeader && cond.leaderScripts && (
        <div className="rounded-xl border bg-card p-6 shadow-card space-y-4">
          <div>
            <h2 className="font-medium">Leader Intervention Scripts</h2>
            <p className="text-xs text-muted-foreground mt-1">
              These scripts are triggered at specific times during the discussion. Only applicable
              to Leader conditions (C2, C4).
            </p>
          </div>
          <div className="grid gap-3">
            {Object.entries(cond.leaderScripts).map(([key, val]) => (
              <div key={key} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {scriptLabels[key] || key}
                  </label>
                  <span className="text-xs font-mono text-primary/70 bg-primary/5 px-2 py-0.5 rounded">
                    {timingLabels[key] || ""}
                  </span>
                </div>
                <textarea
                  defaultValue={val}
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm font-mono resize-none h-16 focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Test Chat Modal */}
      {testOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setTestOpen(false)} />
          <div className="relative w-full max-w-md bg-card border-l shadow-xl flex flex-col animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h3 className="font-semibold text-sm">
                  Test Chat — {selected}: {conditionLabel[selected]}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Testing with current system prompt (unsaved changes included) · gpt-4o-mini
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setTestOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                  A
                </div>
                <div className="rounded-lg bg-muted/50 px-4 py-2.5 text-sm max-w-[85%]">
                  {isLeader
                    ? "Hi everyone! I'm Alex, your team moderator today. We'll be evaluating four candidates for the pilot position. Let's start with Candidate A — what information do each of you have?"
                    : "Hi, I'm Alex, a fellow member of the selection committee. Looking forward to discussing the candidates with you both."}
                </div>
              </div>
            </div>

            <div className="border-t p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  placeholder="Type a test message as Participant X..."
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button size="icon" disabled={!testMsg.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                AI responses are simulated in preview. Connect OpenAI API in production.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Conditions;
