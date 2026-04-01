import { Link } from "react-router-dom";
import { FlaskConical, MessageSquare, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center space-y-8 max-w-md px-4">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
        <FlaskConical className="w-8 h-8 text-primary" />
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">HAIT Experiment</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          Human-AI Team Decision Making — 2×2 Between-Subjects Experiment Platform
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Link to="/chat">
          <Button className="w-full gap-2" size="lg">
            <MessageSquare className="w-4 h-4" />
            Participant Chat
          </Button>
        </Link>
        <Link to="/dashboard">
          <Button variant="outline" className="w-full gap-2" size="lg">
            <LayoutDashboard className="w-4 h-4" />
            Researcher Dashboard
          </Button>
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        4 conditions (Peer/Leader × XAI/ACI) + Control · 25 teams · 55 participants
      </p>
    </div>
  </div>
);

export default Index;
