import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage } from "@/types";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { Timer } from "@/components/chat/Timer";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { FlaskConical } from "lucide-react";

const aiResponses = [
  "That's a great observation! Based on my information, Candidate C also shows excellent concern for others and strong attention skills. These could be really important for a pilot position.",
  "I'd like to add that from what I know, Candidate C has quite a few positive attributes. Has anyone looked into how they handle stressful situations?",
  "Good points from both of you. Let me share — I've seen that C has attention skills that stand out. If we tally up all the positive and negative attributes, C might actually come out ahead.",
  "Interesting discussion! I think we should make sure we consider all four candidates before making our final choice. What about Candidates B and D?",
  "Based on everything we've discussed, it seems like Candidate C has the strongest overall profile with 7 positive attributes. I'd recommend C as our choice. What do you both think?",
];

const ChatRoom = () => {
  const navigate = useNavigate();
  const role = sessionStorage.getItem("role") || "X";
  const otherRole = role === "X" ? "Y" : "X";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiTyping, setAiTyping] = useState(false);
  const [startTime] = useState(new Date());
  const [showDecision, setShowDecision] = useState(false);
  const aiResponseIdx = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiTyping]);

  useEffect(() => {
    const condition = sessionStorage.getItem("condition") || "C1";
    const isLeader = condition === "C2" || condition === "C4";
    const firstMsg = isLeader
      ? "Welcome everyone! I'm Alex, your moderator today. We'll be evaluating four candidates for the pilot position. Let's start by discussing Candidate A — what information do each of you have?"
      : "Hi there! I'm Alex, a fellow member of the selection committee. Looking forward to working through these candidate profiles together.";

    setAiTyping(true);
    const t = setTimeout(() => {
      setAiTyping(false);
      setMessages([{
        id: "ai-0", sender: "AI Alex", senderRole: "ai", content: firstMsg,
        timestamp: new Date(),
      }]);
    }, 2000);
    return () => clearTimeout(t);
  }, []);

  const simulateAI = useCallback(() => {
    if (aiResponseIdx.current >= aiResponses.length) return;
    setAiTyping(true);
    setTimeout(() => {
      setAiTyping(false);
      const resp = aiResponses[aiResponseIdx.current];
      aiResponseIdx.current++;
      setMessages((prev) => [...prev, {
        id: `ai-${Date.now()}`, sender: "AI Alex", senderRole: "ai",
        content: resp, timestamp: new Date(),
      }]);
    }, 2000 + Math.random() * 2000);
  }, []);

  const simulatePartner = useCallback(() => {
    const partnerMsgs = [
      "I agree, that's a good point. I also noticed some things about Candidate C.",
      "From what I've read, C seems very conscientious.",
      "That makes sense. I think C could be a strong choice.",
    ];
    setTimeout(() => {
      setMessages((prev) => [...prev, {
        id: `partner-${Date.now()}`, sender: `Participant ${otherRole}`, senderRole: "other",
        content: partnerMsgs[Math.floor(Math.random() * partnerMsgs.length)],
        timestamp: new Date(),
      }]);
      setTimeout(() => simulateAI(), 1500);
    }, 1000 + Math.random() * 2000);
  }, [otherRole, simulateAI]);

  const handleSend = (content: string) => {
    setMessages((prev) => [...prev, {
      id: `you-${Date.now()}`, sender: "You", senderRole: "you",
      content, timestamp: new Date(),
    }]);
    simulatePartner();
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
        {aiTyping && <TypingIndicator name="Alex" />}
        <div ref={bottomRef} />
      </div>

      {showDecision && (
        <div className="absolute inset-0 bg-foreground/60 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl border p-8 w-full max-w-sm space-y-4 text-center">
            <h2 className="text-lg font-semibold">Final Team Decision</h2>
            <p className="text-sm text-muted-foreground">Discussion complete. Select the team's final choice:</p>
            <div className="grid grid-cols-2 gap-3">
              {(["A", "B", "C", "D"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => handleDecision(c)}
                  className="rounded-lg border-2 border-input hover:border-primary py-4 text-lg font-mono font-bold transition-colors hover:bg-primary/5"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {messages.length > 6 && !showDecision && (
        <div className="px-6 py-2 flex justify-center">
          <button
            onClick={() => setShowDecision(true)}
            className="text-xs text-muted-foreground hover:text-primary transition-colors underline"
          >
            End discussion & make team decision
          </button>
        </div>
      )}

      {!showDecision && <MessageInput onSend={handleSend} />}
    </div>
  );
};

export default ChatRoom;
