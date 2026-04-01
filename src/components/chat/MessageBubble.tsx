import type { ChatMessage } from "@/types";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";

interface MessageBubbleProps {
  message: ChatMessage;
  senderName: string;
}

export const MessageBubble = ({ message, senderName }: MessageBubbleProps) => {
  const isYou = message.senderRole === "you";
  const isAI = message.senderRole === "ai";

  return (
    <div className={cn("flex flex-col gap-1 max-w-[75%]", isYou ? "items-end ml-auto" : "items-start")}>
      <div className="flex items-center gap-2 px-1">
        {isAI && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-chat-ai-badge">
            <Bot className="w-3 h-3" /> AI
          </span>
        )}
        <span className="text-xs font-medium text-muted-foreground">{senderName}</span>
        <span className="text-xs text-muted-foreground/60">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isYou && "bg-chat-user text-chat-user-foreground rounded-br-md",
          !isYou && !isAI && "bg-chat-other text-chat-other-foreground rounded-bl-md",
          isAI && "bg-chat-ai text-chat-ai-foreground rounded-bl-md border border-chat-ai-badge/20"
        )}
      >
        {message.content}
        {message.isStreaming && <span className="inline-block w-1.5 h-4 ml-1 bg-chat-ai-badge/60 animate-pulse rounded-sm" />}
      </div>
    </div>
  );
};
