import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./events.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerSocketHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on("join-session", async ({ sessionCode, participantCode }) => {
      console.log(`[socket] join-session received: ${sessionCode}, ${participantCode}`);
      try {
        // 1. 세션 조회
        const session = await Session.findOne({ sessionCode });
        if (!session) {
          socket.emit("join-error", { reason: "Session not found" });
          return;
        }

        // 2. 참가자 조회
        const participant = await Participant.findOne({ sessionId: session._id, participantCode });
        if (!participant) {
          socket.emit("join-error", { reason: "Participant not registered" });
          return;
        }

        // 3. 현재 방의 인원 수 확인
        const room = io.sockets.adapter.rooms.get(sessionCode);
        const currentSize = room?.size ?? 0;

        // CTRL은 3명, 그 외는 2명까지
        const maxParticipants = session.conditionCode === "CTRL" ? 3 : 2;

        if (currentSize >= maxParticipants) {
          socket.emit("join-error", { reason: "Session is full" });
          return;
        }

        // 4. 방 입장
        await socket.join(sessionCode);
        console.log(
          `[socket] ${socket.id} joined ${sessionCode} (${currentSize + 1}/${maxParticipants})`,
        );

        // 5. 정원 다 차면 전원에게 ready 이벤트 전송
        const newSize = currentSize + 1;
        if (newSize === maxParticipants) {
          //방어코드 : >= 조건으로 고려
          io.to(sessionCode).emit("session-ready", { sessionCode, participantCount: newSize });
        }
      } catch (error) {
        console.error("[socket] join-session error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    });
  });
}
