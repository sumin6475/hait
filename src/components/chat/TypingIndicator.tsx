interface TypingIndicatorProps {
  name: string;
}

export const TypingIndicator = ({ name }: TypingIndicatorProps) => (
  <div className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground">
    <span>{name} is typing</span>
    <span className="flex gap-0.5">
      <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
      <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
      <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
    </span>
  </div>
);
