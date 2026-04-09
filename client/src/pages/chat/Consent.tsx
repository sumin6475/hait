import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

const sections = [
  {
    title: "Purpose of the Study",
    text: "This study examines how humans and AI collaborate in group decision-making tasks. You will participate in a group discussion with another human participant and an AI agent named Alex.",
  },
  {
    title: "Procedure",
    text: "The study takes approximately 45 minutes total: ~15 minutes for preparation (consent, survey, reviewing candidate information), ~20 minutes for group discussion, and ~10 minutes for post-discussion surveys.",
  },
  {
    title: "AI Disclosure",
    text: "This study involves an AI chatbot (Alex) powered by the OpenAI API. Alex will participate in your group discussion. The AI's behavior varies across experimental conditions as part of the research design.",
  },
  {
    title: "Compensation",
    text: "$10 base payment for participation + $3 accuracy bonus if your team selects the best candidate.",
  },
  {
    title: "Confidentiality",
    text: "All data will be anonymized. Your identity will not be linked to your responses. Chat logs will be stored securely and used for research purposes only. Data sent to OpenAI via API is not used for model training.",
  },
  {
    title: "Voluntary Participation",
    text: "Participation is voluntary. You may withdraw at any time without penalty. If you withdraw, your data will be deleted.",
  },
  {
    title: "Contact Information",
    text: "Principal Investigator: Sumin Kim (email@umich.edu). Faculty Sponsor: Kim Siefert (email@umich.edu). For questions about your rights as a research participant, contact the UM-Dearborn IRB.",
  },
];

const Consent = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-2xl bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Informed Consent</h1>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          You are being invited to participate in a research study on team decision-making with AI assistance.
          Please read the following information carefully before deciding whether to participate.
        </p>

        <div className="space-y-3">
          {sections.map((s) => (
            <div key={s.title} className="rounded-lg bg-muted/50 p-4 space-y-2">
              <h3 className="font-medium text-sm">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          ))}
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
