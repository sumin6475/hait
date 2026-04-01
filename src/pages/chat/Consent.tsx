import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

const Consent = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Informed Consent</h1>
        </div>

        <div className="prose prose-sm text-foreground max-w-none space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            You are being invited to participate in a research study on team decision-making with AI assistance.
            Please read the following information carefully before deciding whether to participate.
          </p>

          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">Purpose of the Study</h3>
              <p className="text-sm text-muted-foreground">This study examines how humans and AI collaborate in group decision-making tasks. You will participate in a group discussion with another human participant and an AI agent.</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">Procedure</h3>
              <p className="text-sm text-muted-foreground">You will review candidate information, then participate in a 20-minute group chat discussion. Afterward, you'll complete a brief survey about your experience.</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">Confidentiality</h3>
              <p className="text-sm text-muted-foreground">All data will be anonymized. Your identity will not be linked to your responses. Chat logs will be used for research purposes only.</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">Voluntary Participation</h3>
              <p className="text-sm text-muted-foreground">Participation is voluntary. You may withdraw at any time without penalty.</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => navigate("/chat")}>
            Decline
          </Button>
          <Button className="flex-1" onClick={() => navigate("/chat/demographics")}>
            I Agree to Participate
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Consent;
