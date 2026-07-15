import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { InfoCardPanel } from "@/components/chat/InfoCardPanel";
import type { ProfileSlot } from "@/lib/api";
import { markProgress } from "@/lib/api";

const InfoCards = () => {
  const navigate = useNavigate();
  const profile = (sessionStorage.getItem("assignedProfile") || "X") as ProfileSlot;
  const participantCode = sessionStorage.getItem("participantCode") || "";

  const handleContinue = () => {
    if (participantCode) {
      markProgress(participantCode, "infoCards").catch((error) => {
        console.error("[InfoCards] markProgress failed:", error);
      });
    }
    navigate("/chat/pre-discussion");
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl py-8">
        <InfoCardPanel profile={profile} variant="interactive" />
        <Button onClick={handleContinue} className="w-full mt-6" size="lg">
          I've reviewed all cards — Continue
        </Button>
      </div>
    </div>
  );
};

export default InfoCards;
