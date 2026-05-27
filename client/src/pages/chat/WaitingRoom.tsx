import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, CheckCircle2, Circle } from "lucide-react";
import { socket } from "@/lib/socket";
import { markProgress } from "@/lib/api";

const WaitingRoom = () => {
  const navigate = useNavigate();
  const [dots, setDots] = useState(0);
  const [ready, setReady] = useState(1);
  const [expected, setExpected] = useState(2);

  const profile = sessionStorage.getItem("assignedProfile") || "X";
  const condition = sessionStorage.getItem("conditionCode") || "";
  const isCTRL = condition === "CTRL";

  //CTRL이면 인간 3명 (X/Y/Z) 그 외엔 인간 2명 (X/Y) + AI
  const otherProfiles = isCTRL
    ? ["X", "Y", "Z"].filter((p) => p !== profile)
    : [profile === "X" ? "Y" : "X"];

  useEffect(() => {
    const sessionCode = sessionStorage.getItem("sessionCode");
    const participantCode = sessionStorage.getItem("participantCode");
    if (!sessionCode || !participantCode) {
      console.error("[WaitingRoom] missing sessionCode/participantCode");
      navigate("/");
      return;
    }

    markProgress(participantCode, "waiting").catch((error) => {
      console.error("[WaitingRoom] markProgress error:", error);
    });
    socket.connect();

    socket.on("connect", () => {
      socket.emit("join-waiting", { sessionCode, participantCode });
    });

    socket.on("waiting-update", ({ participantsReady, expected }) => {
      setReady(participantsReady);
      setExpected(expected);
    });

    socket.on("both-ready", () => {
      navigate("/chat/room");
    });

    socket.on("join-error", ({ reason }) => {
      console.error("[WaitingRoom] join-error:", reason);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [navigate]);

  //dots 카운트 표시
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);

  //ready 카운트로 다른 참가자들 표시
  const othersReady = Math.max(0, ready - 1);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm text-center space-y-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <Users className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Waiting Room</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Waiting for team members to join{".".repeat(dots)} ({ready}/{expected})
          </p>
        </div>

        <div className="space-y-3 text-left bg-card rounded-xl border p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-status-success" />
            <span className="text-sm font-medium">You (Participant {profile})</span>
            <span className="ml-auto text-xs text-status-success font-medium">Connected</span>
          </div>
          {otherProfiles.map((p, idx) => {
            const isReady = idx < othersReady;
            return (
              <div key={p} className="flex items-center gap-3">
                {isReady ? (
                  <CheckCircle2 className="w-5 h-5 text-status-success" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground/40" />
                )}
                <span className="text-sm font-medium">Participant {p}</span>
                <span
                  className={`ml-auto text-xs font-medium ${isReady ? "text-status-success" : "text-muted-foreground"}`}
                >
                  {isReady ? "Connected" : "Waiting..."}
                </span>
              </div>
            );
          })}
          {!isCTRL && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-chat-ai-badge" />
              <span className="text-sm font-medium text-muted-foreground">AI Alex</span>
              <span className="ml-auto text-xs font-medium text-chat-ai-badge">Ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WaitingRoom;
