import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, ParticipantRole } from "@/types";
import type { SenderRole } from "@/types";
import { ROLE_LABEL } from "@/lib/labels";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { Timer } from "@/components/chat/Timer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { FlaskConical } from "lucide-react";
import { socket } from "@/lib/socket";

const ChatRoom = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  //[Step 26-A] 서버 startedAt 기준 (session-history로 수신) — 새로고침해도 타이머 리셋 안 됨
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [myRole, setMyRole] = useState<SenderRole | null>(null);
  //[Step 30] 조건별 AI 표시명 (session-history로 수신) — 메시지 객체에 박지 않고 렌더 시 state로 읽음
  const [aiName, setAiName] = useState("Alex"); // 폴백 — 서버가 안 보내도 동작
  //[Step 36] 최소 토론 12분 경과 전엔 Exit 버튼 숨김 (서버 TRIGGER_CONFIG.MIN_DISCUSSION_MS와 일치)
  const [canExit, setCanExit] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  //auto scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  //[Step 36] 서버 startedAt 기준 12분 경과 시 Exit 버튼 노출 (1초 틱)
  useEffect(() => {
    if (!startTime || canExit) return;
    const MIN_DISCUSSION_MS = 12 * 60 * 1000;
    const check = () => {
      if (Date.now() - startTime.getTime() >= MIN_DISCUSSION_MS) setCanExit(true);
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [startTime, canExit]);

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
      navigate("/chat");
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
    socket.on("session-history", ({ messages, startedAt, aiName }) => {
      console.log(`[chatroom] session-history: ${messages.length} messages`);
      //[Step 26-A] 서버 시작 시각으로 타이머 동기화 (없으면 클라 시각 fallback)
      setStartTime(startedAt ? new Date(startedAt) : new Date());
      if (aiName) setAiName(aiName); // [Step 30] 조건별 AI 라벨
      const mapped: ChatMessage[] = messages.map((m) => ({
        id: `msg-${m.seq}`,
        sender: m.sender,
        senderRole: m.senderRole === roleHint ? "you" : m.senderRole === "ai" ? "ai" : "other",
        content: m.content,
        timestamp: new Date(m.createdAt),
        senderName:
          m.senderRole === "ai" ? "" : (ROLE_LABEL[m.senderRole as ParticipantRole] ?? m.sender),
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
          senderName:
            msg.senderRole === "ai"
              ? ""
              : (ROLE_LABEL[msg.senderRole as ParticipantRole] ?? msg.sender),
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
    navigate("/chat/hold/teamDecision");
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-primary" />
          <span className="font-semibold">HAIT Experiment</span>
          {myRole && (
            <span className="text-xs text-muted-foreground ml-2">
              (you: {ROLE_LABEL[myRole as ParticipantRole] ?? myRole})
            </span>
          )}
        </div>
        {startTime && (
          <Timer durationMinutes={20} startTime={startTime} onExpired={handleTimerExpired} />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            senderName={msg.senderRole === "ai" ? aiName : msg.senderName}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/*[Step 36] 12분 경과 후에만 노출 (early-close 차단) + 라벨을 소진 close 프롬프트와 일치*/}
      {canExit && (
        <div className="px-6 py-2 flex justify-center">
          <button
            onClick={() => navigate("/chat/hold/teamDecision")}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
          >
            Exit &amp; Make Team Decision
          </button>
        </div>
      )}

      <MessageInput onSend={handleSend} />
    </div>
  );
};

export default ChatRoom;
