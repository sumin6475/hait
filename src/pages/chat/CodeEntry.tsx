import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

const CodeEntry = () => {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const validateCode = (code: string) => {
    const pattern = /^EXP-(C[1-4]|CT)-T\d{2}-[XYZ]$/;
    return pattern.test(code.toUpperCase());
  };

  const handleSubmit = () => {
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Please enter your participant code.");
      return;
    }
    const upper = trimmed.toUpperCase();
    if (!validateCode(upper)) {
      setError("Invalid participant code. Please check your code and try again.");
      return;
    }
    sessionStorage.setItem("participantCode", upper);
    const parts = upper.split("-");
    sessionStorage.setItem("condition", parts[1]);
    sessionStorage.setItem("team", parts[2]);
    sessionStorage.setItem("role", parts[3]);
    navigate("/chat/consent");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8">
        <div className="flex flex-col items-center gap-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FlaskConical className="w-7 h-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">HAIT Experiment</h1>
            <p className="mt-2 text-sm text-muted-foreground">Enter your participant code to begin</p>
          </div>
          <div className="w-full space-y-4">
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="EXP-C1-T01-X"
              className={cn(
                "w-full rounded-lg border bg-card px-4 py-3 text-center font-mono text-lg tracking-widest placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring",
                error ? "border-destructive focus:ring-destructive" : "border-input"
              )}
            />
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={handleSubmit} className="w-full" size="lg">
              Continue
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Your code was provided by the research team. It contains your condition and team assignment.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CodeEntry;
