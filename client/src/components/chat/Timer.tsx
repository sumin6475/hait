import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface TimerProps {
  durationMinutes: number;
  startTime: Date;
  onExpired?: () => void;
}

export const Timer = ({ durationMinutes, startTime, onExpired }: TimerProps) => {
  const [remaining, setRemaining] = useState(durationMinutes * 60);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
      const left = Math.max(0, durationMinutes * 60 - elapsed);
      setRemaining(left);
      if (left === 0) onExpired?.();
    }, 1000);
    return () => clearInterval(interval);
  }, [durationMinutes, startTime, onExpired]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const isLow = remaining < 120;

  return (
    <div
      className={`flex items-center gap-1.5 text-sm font-mono font-medium ${isLow ? "text-destructive" : "text-muted-foreground"}`}
    >
      <Clock className="w-4 h-4" />
      <span>
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
      <span className="text-xs font-sans">remaining</span>
    </div>
  );
};
