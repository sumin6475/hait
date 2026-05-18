import { useEffect } from "react";
import { socket } from "./lib/socket";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

// Chat flow
import CodeEntry from "./pages/chat/CodeEntry.tsx";
import Consent from "./pages/chat/Consent.tsx";
import Demographics from "./pages/chat/Demographics.tsx";
import InfoCards from "./pages/chat/InfoCards.tsx";
import PreDiscussion from "./pages/chat/PreDiscussion.tsx";
import WaitingRoom from "./pages/chat/WaitingRoom.tsx";
import ChatRoom from "./pages/chat/ChatRoom.tsx";
import PostSurvey from "./pages/chat/PostSurvey.tsx";
import TeamDecision from "./pages/chat/TeamDecision.tsx";
import Debrief from "./pages/chat/Debrief.tsx";
import Complete from "./pages/chat/Complete.tsx";

// Dashboard
import DashboardLayout from "./components/dashboard/DashboardLayout.tsx";
import Overview from "./pages/dashboard/Overview.tsx";
import Conditions from "./pages/dashboard/Conditions.tsx";
import Sessions from "./pages/dashboard/Sessions.tsx";
import ChatLogs from "./pages/dashboard/ChatLogs.tsx";
import Analytics from "./pages/dashboard/Analytics.tsx";
import Surveys from "./pages/dashboard/Surveys.tsx";

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    // URL에서 코드 읽기
    // 예: http://localhost:8080?session=S-Test-...&participant=P-X-001
    const params = new URLSearchParams(window.location.search);
    const sessionCode = params.get("session");
    const participantCode = params.get("participant");

    if (!sessionCode || !participantCode) {
      console.warn("[client] no session/participant code in URL, skipping socket");
      return;
    }

    let lastSeenSeq = -1;
    let hasJoinedOnce = false;

    socket.connect();
    (window as any).socket = socket;

    socket.on("connect", () => {
      console.log(`[client] connected to server`, socket.id);

      if (hasJoinedOnce) {
        console.log(`[client] reconnecting with lastSeenSeq:`, lastSeenSeq);
        socket.emit("join-session", {
          sessionCode,
          participantCode,
          lastSeenSeq,
        });
      } else {
        console.log(`[client] first join`);
        socket.emit("join-session", {
          sessionCode,
          participantCode,
        });
        hasJoinedOnce = true;
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[client] disconnected: `, reason);
    });

    //----- session events -----
    socket.on("session-ready", ({ sessionCode, participantCount }) => {
      console.log(`[clinet] session-ready! ${sessionCode} (${participantCount} participants)`);
    });

    socket.on("join-error", ({ reason }) => {
      console.log(`[client] join-error: ${reason}`);
    });

    //----- message events -----
    socket.on("new-message", (msg) => {
      console.log(`[msg] #${msg.seq} ${msg.senderRole} : ${msg.content}`);
      if (msg.seq > lastSeenSeq) lastSeenSeq = msg.seq;
    });

    socket.on("message-failed", ({ reason }) => {
      console.error(`[client] message-failed`, reason);
    });

    //----- missed messages -----
    socket.on("missed-messages", (payload) => {
      console.log(`[clinet] missed messages: ${payload.messages.length} messages`);
      payload.messages.forEach((m) => {
        console.log(`   > seq ${m.seq} [${m.senderRole}]: ${m.content}`);
        if (m.seq > lastSeenSeq) lastSeenSeq = m.seq;
      });
    });

    //----- peer events -----
    socket.on("peer-disconnected", (payload) => {
      console.log(`[client] ⚠️ peer-disconnected: ${payload.role}`);
    });

    socket.on("peer-reconnected", (payload) => {
      console.log(`[clinet] ✅ peer-reconnected: ${payload.role}`);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />

            {/* Participant Chat Flow */}
            <Route path="/chat" element={<CodeEntry />} />
            <Route path="/chat/consent" element={<Consent />} />
            <Route path="/chat/demographics" element={<Demographics />} />
            <Route path="/chat/info-cards" element={<InfoCards />} />
            <Route path="/chat/pre-discussion" element={<PreDiscussion />} />
            <Route path="/chat/waiting" element={<WaitingRoom />} />
            <Route path="/chat/room" element={<ChatRoom />} />
            <Route path="/chat/team-decision" element={<TeamDecision />} />
            <Route path="/chat/post-survey" element={<PostSurvey />} />
            <Route path="/chat/debrief" element={<Debrief />} />
            <Route path="/chat/complete" element={<Complete />} />

            {/* Researcher Dashboard */}
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<Overview />} />
              <Route path="conditions" element={<Conditions />} />
              <Route path="sessions" element={<Sessions />} />
              <Route path="chat-logs" element={<ChatLogs />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="surveys" element={<Surveys />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};
export default App;
