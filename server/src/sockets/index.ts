import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export function registerSocketHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on("join-session", async ({ sessionCode, participantCode, lastSeenSeq }) => {
      //console.log(`[socket] join-session received: ${sessionCode}, ${participantCode}`);
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

        // 처음 접속인지 파악 - 지금 접속한 participantCode가 이미 방에 있는지 확인
        let isReconnect = false;
        if (room) {
          for (const socketId of room) {
            const othersocket = io.sockets.sockets.get(socketId);
            if (othersocket?.data.participantCode === participantCode) {
              // 재접속으로 처리
              isReconnect = true;
              break;
            }
          }
        }
        // 4. 정원 체크 - 재입장이 아닌 경우에만
        if (!isReconnect && currentSize >= maxParticipants) {
          socket.emit("join-error", { reason: "Session is full" });
          return;
        }

        // 5. 방 입장
        await socket.join(sessionCode);

        // 6. socket.data 정보저장
        socket.data.sessionCode = sessionCode;
        socket.data.sessionId = session._id.toString();
        socket.data.participantCode = participantCode;
        socket.data.role = participant.role;

        console.log(
          `[socket] ${socket.id} (${participant.role}) joined ${sessionCode} (${currentSize + 1}/${maxParticipants}) ${lastSeenSeq != null ? "[reconnected]" : ""}`,
        );

        // 7. 재접속이면 missed messages 전송

        if (lastSeenSeq != null && lastSeenSeq > 0) {
          const missed = await Message.find({
            sessionId: session._id,
            seq: { $gt: lastSeenSeq },
          }).sort({ seq: 1 });

          if (missed.length > 0) {
            socket.emit("missed-messages", {
              messages: missed.map((m) => ({
                seq: m.seq,
                sender: m.sender,
                senderRole: m.senderRole,
                content: m.content,
                createdAt: (m as any).createdAt.toISOString(),
              })),
            });
          }
          console.log(`[socket] sent ${missed.length} missed messages to ${participant.role}`);
        }

        //8. 재접속 알림
        socket.to(sessionCode).emit("peer-reconnected", { role: participant.role });

        // 9. 정원 다 차면 전원에게 ready 이벤트 전송 (broadcast) - 신규 입장일때만
        const newSize = currentSize + 1;
        if (newSize >= maxParticipants && !isReconnect) {
          io.to(sessionCode).emit("session-ready", { sessionCode, participantCount: newSize });
        }
      } catch (error) {
        console.error("[socket] join-session error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });
    socket.on("send-message", async ({ content }) => {
      try {
        //1. socket.data 검증
        const { sessionCode, sessionId, participantCode, role } = socket.data;
        if (!sessionCode || !sessionId) {
          socket.emit("message-failed", { reason: "Not in a sesion. Join first" });
          return;
        }

        //2. content 검증
        const trimmed = content?.trim() ?? "";
        if (!trimmed) {
          socket.emit("message-failed", { reason: "Empty message" });
          return;
        }
        if (trimmed.length > 2000) {
          socket.emit("message-failed", { reason: "Message too long (max 2000)" });
          return;
        }

        //3. seq 부여 - 이 세션의 마지막 메시지 seq + 1
        const lastMsg = await Message.findOne({ sessionId }).sort({ seq: -1 });
        const nextSeq = (lastMsg?.seq ?? 0) + 1;

        //4. DB 저장
        const savedMessage = await Message.create({
          sessionId,
          sender: participantCode,
          senderRole: role,
          content: trimmed,
          seq: nextSeq,
          sharedInfoIds: [],
        });
        console.log(`[socket] message saved: ${sessionCode} seq=${nextSeq} role=${role}`);

        //5. 같은 방 전원에게 broadcast (본인 포함)
        io.to(sessionCode).emit("new-message", {
          seq: savedMessage.seq,
          sender: savedMessage.sender,
          senderRole: savedMessage.senderRole,
          content: savedMessage.content,
          createAt: savedMessage.createdAt.toISOString(),
        });
      } catch (error) {
        console.error(`[socket] send-message error:`, error);
        socket.emit("message-failed", { reason: "Server error while saving message" });
      }
    });
    socket.on("disconnect", async (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (${reason})`);
      //socket.data에 정보 있으면 peer 에게 알림
      const { sessionCode, role, participantCode, sessionId } = socket.data;
      if (sessionCode && role) {
        //peer에게 알림
        socket.to(sessionCode).emit("peer-disconnected", { role });
        console.log(`[socket] ${role} disconnected from ${sessionCode}`);

        //마지막 활동 시간
        if (participantCode && sessionId) {
          try {
            await Participant.findOneAndUpdate(
              { sessionId, participantCode },
              { lastSeenAt: new Date() },
            );
          } catch (error) {
            console.error(`[socker] failed to update lastSeenAt:`, error);
          }
        }
      }
    });
  });
}
