import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, CheckCircle2, Circle } from "lucide-react";

const WaitingRoom = () => {
  const navigate = useNavigate();
  const [dots, setDots] = useState(0);
  const [partner, setPartner] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPartner(true), 3000);
    const t2 = setTimeout(() => navigate("/chat/room"), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [navigate]);

  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);

  const role = sessionStorage.getItem("role") || "X";
  const otherRole = role === "X" ? "Y" : "X";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center space-y-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Users className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Waiting Room</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Waiting for team members to join{".".repeat(dots)}
          </p>
        </div>

        <div className="space-y-3 text-left bg-card rounded-xl border p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-status-success" />
            <span className="text-sm font-medium">You (Participant {role})</span>
            <span className="ml-auto text-xs text-status-success font-medium">Connected</span>
          </div>
          <div className="flex items-center gap-3">
            {partner ? (
              <CheckCircle2 className="w-5 h-5 text-status-success" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground/40" />
            )}
            <span className="text-sm font-medium text-muted-foreground">
              Participant {otherRole}
            </span>
            <span
              className={`ml-auto text-xs font-medium ${partner ? "text-status-success" : "text-muted-foreground"}`}
            >
              {partner ? "Connected" : "Waiting..."}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-chat-ai-badge" />
            <span className="text-sm font-medium text-muted-foreground">AI Alex</span>
            <span className="ml-auto text-xs font-medium text-chat-ai-badge">Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
