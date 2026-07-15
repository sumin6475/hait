import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, ParticipantRole } from "@/types";
import type { SenderRole } from "@/types";
import { ROLE_LABEL } from "@/lib/labels";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { Timer } from "@/components/chat/Timer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { InfoCardPanel } from "@/components/chat/InfoCardPanel";
import { FlaskConical } from "lucide-react";
import { socket } from "@/lib/socket";
import { getParticipantState, type ProfileSlot } from "@/lib/api";
import { DISCUSSION_DURATION_MINUTES, MIN_DISCUSSION_MINUTES } from "@/lib/sessionConfig";

const ChatRoom = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  //[Step 26-A] 서버 startedAt 기준 (session-history로 수신) — 새로고침해도 타이머 리셋 안 됨
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [myRole, setMyRole] = useState<SenderRole | null>(null);
  const [profile, setProfile] = useState<ProfileSlot | null>(null);
  //[Step 30] 조건별 AI 표시명 (session-history로 수신) — 메시지 객체에 박지 않고 렌더 시 state로 읽음
  const [aiName, setAiName] = useState("Alex"); // 폴백 — 서버가 안내도 동작
  //[Step 36] 최소 토론 12분 경과 전엔 Exit 버튼 숨김
  const [canExit, setCanExit] = useState(false);
  //타이머 만료 시 자동 넘김 제거 — 참가자가 Exit 버튼을 눌러야만 진행. timeUp은 안내 문구용.
  const [timeUp, setTimeUp] = useState(false);
  //현재 입력 중(작성중)인 상대 역할들 — peer-typing으로 갱신, 메시지 도착/퇴장 시 해제
  const [typingRoles, setTypingRoles] = useState<ParticipantRole[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  //auto scroll to bottom (작성중 표시 등장 시에도 따라 내려감)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingRoles]);

  //[Step 36] 서버 startedAt 기준 최소 토론 시간 경과 시 Exit 버튼 노출 (1초 틱)
  useEffect(() => {
    if (!startTime || canExit) return;
    const MIN_DISCUSSION_MS = MIN_DISCUSSION_MINUTES * 60 * 1000;
    const check = () => {
      if (Date.now() - startTime.getTime() >= MIN_DISCUSSION_MS) setCanExit(true);
    };
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [startTime, canExit]);

  //서버 authoritative 프로필 — 본인 info-card만 표시 (소켓/타 참가자 데이터 사용 안 함)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const participantCode =
      params.get("participant") ?? sessionStorage.getItem("participantCode") ?? undefined;

    if (!participantCode) return;

    getParticipantState(participantCode)
      .then((state) => setProfile(state.assignedProfile))
      .catch((error) => {
        console.error("[chatroom] getParticipantState failed:", error);
        const fallback = sessionStorage.getItem("assignedProfile") as ProfileSlot | null;
        if (fallback) setProfile(fallback);
      });
  }, []);

  //connect to socket
  useEffect(() => {
    //1. URL 파라미터 우선 (테스트 하니스/직접 URL 접속: ?session=...&participant=...)
    //2. sessionStorage fallback (정상 흐름: CodeEntry → ... → ChatRoom, 쿼리스트링 없음)
    //   순서를 URL 먼저로 둔 이유: Test Harness는 같은 탭 두 iframe이 sessionStorage를
    //   공유하므로, 쿼리로 X/Y를 구분해야 한다. 정상 흐름은 쿼리가 없어 자동으로 storage로 폴백.
    const params = new URLSearchParams(window.location.search);
    const sessionCode = params.get("session") ?? sessionStorage.getItem("sessionCode") ?? undefined;
    const participantCode =
      params.get("participant") ?? sessionStorage.getItem("participantCode") ?? undefined;

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

    //peer-typing: 상대 입력 중 표시 갱신 (서버가 본인 제외 릴레이)
    socket.on("peer-typing", ({ role, isTyping }) => {
      setTypingRoles((prev) => {
        const has = prev.includes(role);
        if (isTyping && !has) return [...prev, role];
        if (!isTyping && has) return prev.filter((r) => r !== role);
        return prev;
      });
    });

    //new message
    socket.on("new-message", (msg) => {
      //메시지를 보냈으면 더 이상 작성중 아님 → 해제
      setTypingRoles((prev) => prev.filter((r) => r !== msg.senderRole));
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
      //나간 상대의 작성중 잔상 제거
      setTypingRoles((prev) => prev.filter((r) => r !== role));
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

  //자동 넘김 제거 — 만료돼도 navigate 안 함. Exit 버튼(수동)만 team-decision으로 진행.
  const handleTimerExpired = () => {
    setTimeUp(true);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-card shrink-0">
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
          <Timer
            durationMinutes={DISCUSSION_DURATION_MINUTES}
            startTime={startTime}
            onExpired={handleTimerExpired}
          />
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-[2] flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                senderName={msg.senderRole === "ai" ? aiName : msg.senderName}
              />
            ))}
            {typingRoles.map((role) => (
              <TypingIndicator key={role} name={ROLE_LABEL[role] ?? role} />
            ))}
            <div ref={bottomRef} />
          </div>

          {timeUp && (
            <p className="text-center text-xs text-muted-foreground px-6 shrink-0">
              Time's up — click Exit below when your team is ready.
            </p>
          )}

          {canExit && (
            <div className="px-6 py-2 flex justify-center shrink-0">
              <button
                onClick={() => navigate("/chat/hold/teamDecision")}
                className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
              >
                Exit &amp; Make Team Decision
              </button>
            </div>
          )}

          <MessageInput
            onSend={handleSend}
            onTyping={(isTyping) => socket.emit("typing", { isTyping })}
          />
        </div>

        <aside className="hidden md:flex flex-[1] min-w-[240px] max-w-[420px] flex-col border-l bg-muted/20 overflow-y-auto">
          {profile ? (
            <InfoCardPanel
              profile={profile}
              variant="static"
              compact
              showNote={false}
              showTitle
            />
          ) : (
            <div className="p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-20 bg-muted rounded" />
              <div className="h-20 bg-muted rounded" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default ChatRoom;
