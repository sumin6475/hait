import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface MessageInputProps {
  onSend: (message: string) => void;
  // 입력 중 상태 변화 알림 (작성중 표시용). 시작 시 true, 멈춤/전송 시 false.
  onTyping?: (isTyping: boolean) => void;
  disabled?: boolean;
}

const TYPING_IDLE_MS = 1500; // 이 시간만큼 입력이 없으면 '작성중' 해제

export const MessageInput = ({ onSend, onTyping, disabled }: MessageInputProps) => {
  const [value, setValue] = useState("");
  const isTypingRef = useRef(false); // 중복 emit 방지 — 상태 변할 때만 알림
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();

  // 작성중 상태를 한 곳에서만 전이 (멱등) — true/false 중복 emit 차단
  const setTyping = (next: boolean) => {
    if (isTypingRef.current === next) return;
    isTypingRef.current = next;
    onTyping?.(next);
  };

  // 입력 발생 → 작성중 on + idle 타이머 리셋
  const handleChange = (next: string) => {
    setValue(next);
    if (next.trim()) {
      setTyping(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setTyping(false), TYPING_IDLE_MS);
    } else {
      // 입력칸이 비면 즉시 해제
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false);
    }
  };

  // 언마운트 시 타이머 정리 + 작성중 해제 (상대 화면에 잔상 방지)
  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
      if (idleTimer.current) clearTimeout(idleTimer.current);
      setTyping(false); // 전송 직후 작성중 해제
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center gap-2 p-4 border-t bg-card">
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your message..."
        disabled={disabled}
        className="flex-1 rounded-full border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <Button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        size="icon"
        className="rounded-full shrink-0"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
};
