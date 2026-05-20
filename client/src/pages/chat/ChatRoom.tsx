import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "@/types";
import type { SenderRole } from "@/types";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { Timer } from "@/components/chat/Timer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { FlaskConical } from "lucide-react";
import { socket } from "@/lib/socket";

const ChatRoom = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [startTime] = useState(new Date());
  const [myRole, setMyRole] = useState<SenderRole | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  //auto scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  //connect to socket
  useEffect(() => {
    //1. sessionStorage 우선 (정상 흐름: CodeEntry → ... → ChatRoom)
    //2. URL 파라미터 fallback (테스트/직접 URL 접속 시: ?session=...&participant=...)
    const params = new URLSearchParams(window.location.search);
    const sessionCode = sessionStorage.getItem("sessionCode") ?? params.get("session") ?? undefined;
    const participantCode =
      sessionStorage.getItem("participantCode") ?? params.get("participant") ?? undefined;

    if (!sessionCode || !participantCode) {
      console.warn("[chatroom] no session/participant in sessionStorage or URL");
      return;
    }

    console.log(`[chatroom] joining ${sessionCode} as ${participantCode}`);

    //participantCode → myRole 파싱
    //형식: P-X-C1-001 또는 TP-X-C1-001
    //X/Y/Z는 두번째 토큰 (split("-")[1])
    const slot = participantCode.split("-")[1]; //X|Y|Z
    const roleHint: SenderRole | null =
      slot === "X" ? "humanX" : slot === "Y" ? "humanY" : slot === "Z" ? "humanZ" : null;
    setMyRole(roleHint);

    socket.connect();
    (window as any).socket = socket;

    socket.on("connect", () => {
      console.log("[chatroom] connected", socket.id);
      socket.emit("join-session", { sessionCode, participantCode });
    });

    socket.on("disconnect", (reason) => {
      console.log("[chatroom] disconnected", reason);
    });

    socket.on("session-ready", ({ sessionCode, participantCount }) => {
      console.log(`[chatroom] session ready: ${sessionCode} (${participantCount} participants)`);
    });

    socket.on("join-error", ({ reason }) => {
      console.error(`[chatroom] join error: ${reason}`);
    });

    //session history
    socket.on("session-history", ({ messages }) => {
      console.log(`[chatroom] session-history: ${messages.length} messages`);
      const mapped: ChatMessage[] = messages.map((m) => ({
        id: `msg-${m.seq}`,
        sender: m.sender,
        senderRole: m.senderRole === roleHint ? "you" : m.senderRole === "ai" ? "ai" : "other",
        content: m.content,
        timestamp: new Date(m.createdAt),
      }));
      setMessages(mapped);
    });

    //new message
    socket.on("new-message", (msg) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${msg.seq}`,
          sender: msg.sender,
          senderRole:
            msg.senderRole === roleHint ? "you" : msg.senderRole === "ai" ? "ai" : "other",
          content: msg.content,
          timestamp: new Date(msg.createdAt),
        },
      ]);
    });

    socket.on("message-failed", ({ reason }) => {
      console.error("[chatroom] message-failed", reason);
    });

    socket.on("peer-disconnected", ({ role }) => {
      console.log(`[chatroom] peer-disconnected: ${role}`);
    });

    socket.on("peer-reconnected", ({ role }) => {
      console.log(`[chatroom] peer-reconnected: ${role}`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  const handleSend = (content: string) => {
    socket.emit("send-message", { content });
    //ui에는 추가 안함
  };

  const handleTimerExpired = () => {
    navigate("/chat/team-decision");
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          <span className="font-semibold">HAIT Experiment</span>
          {myRole && <span className="text-xs text-muted-foreground ml-2">(you: {myRole})</span>}
        </div>
        <Timer durationMinutes={20} startTime={startTime} onExpired={handleTimerExpired} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            senderName={msg.senderRole === "ai" ? "Alex — AI Moderator" : msg.sender}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {messages.length > 6 && (
        <div className="px-6 py-2 flex justify-center">
          <button
            onClick={() => navigate("/chat/team-decision")}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
          >
            End discussion & make team decision
          </button>
        </div>
      )}

      <MessageInput onSend={handleSend} />
    </div>
  );
};

export default ChatRoom;
