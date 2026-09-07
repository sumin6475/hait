import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events.js";
import type { ConditionCode, ParticipantRole } from "../types.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { allocHumanSeq } from "../lib/seq.js";
import { extractSurfacedTraits } from "../lib/poolingExtractor.js";
import { updateRevealStats } from "../lib/poolingTally.js";
import { aiDisplayName } from "../lib/labels.js";
import { log } from "../lib/log.js";
import { startTurnTrace, traceTurnEvent } from "../lib/turnTrace.js";
import {
  noteHumanMessageArrival,
  onHumanMessage,
  pauseInterventionSession,
  startInterventionSession,
} from "../lib/interventionEngine.js";
import { enqueueConversationObservation } from "../lib/conversationObserver.js";
import { detectExplicitAlexDefer } from "../lib/interventionRoutingV2.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

interface LedgerTurnReservation {
  waitForPrior: Promise<void>;
  release: () => void;
}

// Socket callbacks from two participants can overlap. Keep chat saves and
// broadcasts immediate, but serialize ledger commits in callback-arrival order
// so a later routing decision never observes an unprocessed earlier message.
const ledgerTails = new Map<string, Promise<void>>();

function reserveLedgerTurn(sessionId: string): LedgerTurnReservation {
  const prior = ledgerTails.get(sessionId) ?? Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  const tail = prior.catch(() => undefined).then(() => current);
  ledgerTails.set(sessionId, tail);
  let released = false;
  return {
    waitForPrior: prior.catch(() => undefined),
    release: () => {
      if (released) return;
      released = true;
      resolveCurrent();
      void tail.finally(() => {
        if (ledgerTails.get(sessionId) === tail) ledgerTails.delete(sessionId);
      });
    },
  };
}

function presentRoles(io: IO, roomName: string): Set<string> {
  const room = io.sockets.adapter.rooms.get(roomName);
  const roles = new Set<string>();
  if (!room) return roles;
  for (const socketId of room) {
    const role = io.sockets.sockets.get(socketId)?.data?.role;
    if (role) roles.add(role);
  }
  return roles;
}

function requiredRolesFor(conditionCode: string): ParticipantRole[] {
  return conditionCode === "CTRL" ? ["humanX", "humanY", "humanZ"] : ["humanX", "humanY"];
}

export function registerSocketHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    log.debug(`[socket] connected: ${socket.id}`);

    socket.on("join-session", async ({ sessionCode, participantCode }) => {
      try {
        const session = await Session.findOne({ sessionCode });
        if (!session) {
          socket.emit("join-error", { reason: "Session not found" });
          return;
        }
        const participant = await Participant.findOne({ sessionId: session._id, participantCode });
        if (!participant) {
          socket.emit("join-error", { reason: "Participant not registered" });
          return;
        }

        const room = io.sockets.adapter.rooms.get(sessionCode);
        const currentSize = room?.size ?? 0;
        const maxParticipants = session.conditionCode === "CTRL" ? 3 : 2;
        const isReconnect =
          !!room &&
          [...room].some(
            (socketId) =>
              io.sockets.sockets.get(socketId)?.data.participantCode === participantCode,
          );
        const requiredRoles = requiredRolesFor(session.conditionCode);
        if (!requiredRoles.includes(participant.role)) {
          socket.emit("join-error", {
            reason: `Role ${participant.role} is not part of this session.`,
          });
          return;
        }
        const roleTakenByOther =
          !!room &&
          [...room].some((socketId) => {
            const member = io.sockets.sockets.get(socketId);
            return (
              member?.data.role === participant.role &&
              member?.data.participantCode !== participantCode
            );
          });
        if (roleTakenByOther) {
          socket.emit("join-error", {
            reason: `Role ${participant.role} is already taken in this session — check your participant code.`,
          });
          return;
        }
        if (!isReconnect && currentSize >= maxParticipants) {
          socket.emit("join-error", { reason: "Session is full" });
          return;
        }

        await socket.join(sessionCode);
        socket.data.sessionCode = sessionCode;
        socket.data.sessionId = session._id.toString();
        socket.data.participantCode = participantCode;
        socket.data.role = participant.role;
        socket.data.conditionCode = session.conditionCode as ConditionCode;

        const allMessages = await Message.find({ sessionId: session._id }).sort({ seq: 1 });
        socket.emit("session-history", {
          messages: allMessages.map((message) => ({
            seq: message.seq,
            sender: message.sender,
            senderRole: message.senderRole,
            content: message.content,
            createdAt: (message as any).createdAt.toISOString(),
          })),
          startedAt: session.startedAt ? session.startedAt.toISOString() : null,
          aiName: aiDisplayName(session.conditionCode as ConditionCode),
        });
        log.debug(`[socket] sent ${allMessages.length} history messages to ${participant.role}`);

        if (isReconnect) {
          socket.to(sessionCode).emit("peer-reconnected", { role: participant.role });
          log.info(`[session] ${participant.role} rejoined ${sessionCode}`);
        }

        const present = presentRoles(io, sessionCode);
        const allRolesPresent = requiredRoles.every((role) => present.has(role));
        const roomSize = io.sockets.adapter.rooms.get(sessionCode)?.size ?? 0;
        if (!allRolesPresent && roomSize >= maxParticipants) {
          log.warn(
            `[socket] ${sessionCode}: ${roomSize} sockets but roles=[${[...present]}]; session not started`,
          );
        }
        if (!allRolesPresent) return;

        // The conditional update keeps simultaneous joins from starting twice.
        const won = await Session.findOneAndUpdate(
          { _id: session._id, status: "waiting" },
          { $set: { status: "in_progress", startedAt: new Date() } },
          { returnDocument: "after" },
        );
        const startedAt = won?.startedAt ?? session.startedAt;
        if (!startedAt) return;
        if (won) log.info(`[socket] session ${sessionCode} status: waiting -> in_progress`);

        // Greeting initialization completes before clients receive the authoritative start event.
        if (session.conditionCode !== "CTRL") {
          await startInterventionSession({
            io,
            sessionCode,
            sessionId: session._id.toString(),
            conditionCode: session.conditionCode as ConditionCode,
            startedAt,
          });
        }
        if (won) {
          io.to(sessionCode).emit("session-ready", {
            sessionCode,
            participantCount: roomSize,
            startedAt: startedAt.toISOString(),
          });
        }
      } catch (error) {
        log.error("[socket] join-session error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });

    socket.on("join-waiting", async ({ sessionCode, participantCode }) => {
      try {
        const session = await Session.findOne({ sessionCode });
        if (!session) {
          socket.emit("join-error", { reason: "Session not found" });
          return;
        }
        const participant = await Participant.findOne({ sessionId: session._id, participantCode });
        if (!participant) {
          socket.emit("join-error", { reason: "Participant not registered" });
          return;
        }
        if (session.status === "in_progress") {
          socket.emit("both-ready", { sessionCode });
          return;
        }

        const waitingRoom = `waiting:${sessionCode}`;
        socket.data.role = participant.role;
        await socket.join(waitingRoom);
        await Participant.updateOne({ _id: participant._id }, { $set: { lastSeenAt: new Date() } });

        const room = io.sockets.adapter.rooms.get(waitingRoom);
        const present = presentRoles(io, waitingRoom);
        const requiredRoles = requiredRolesFor(session.conditionCode);
        const ready = requiredRoles.every((role) => present.has(role));
        io.to(waitingRoom).emit("waiting-update", {
          participantsReady: present.size,
          expected: requiredRoles.length,
        });
        if (ready) {
          io.to(waitingRoom).emit("both-ready", { sessionCode });
          log.info(`[socket] both-ready (roles complete): ${sessionCode}`);
        } else if (room && room.size >= requiredRoles.length) {
          log.warn(`[socket] waiting ${sessionCode}: duplicate participant role suspected`);
        }
      } catch (error) {
        log.error("[socket] join-waiting error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });

    socket.on("send-message", async ({ content }) => {
      let ledgerTurn: LedgerTurnReservation | undefined;
      try {
        const { sessionCode, sessionId, participantCode, role, conditionCode } = socket.data;
        if (!sessionCode || !sessionId) {
          socket.emit("message-failed", { reason: "Not in a session. Join first" });
          return;
        }
        const trimmed = content?.trim() ?? "";
        if (!trimmed) {
          socket.emit("message-failed", { reason: "Empty message" });
          return;
        }
        if (trimmed.length > 2_000) {
          socket.emit("message-failed", { reason: "Message too long (max 2000)" });
          return;
        }
        if (conditionCode !== "CTRL") ledgerTurn = reserveLedgerTurn(sessionId);

        const humanTurn = await allocHumanSeq(sessionId);
        const nextSeq = humanTurn.seq;
        const savedMessage = await Message.create({
          sessionId,
          sender: participantCode,
          senderRole: role,
          content: trimmed,
          seq: nextSeq,
          sharedInfoIds: [],
        });
        io.to(sessionCode).emit("new-message", {
          seq: savedMessage.seq,
          sender: savedMessage.sender,
          senderRole: savedMessage.senderRole,
          content: savedMessage.content,
          createdAt: savedMessage.createdAt.toISOString(),
        });
        if (conditionCode !== "CTRL") {
          startTurnTrace({
            sessionId: sessionId.toString(),
            sessionCode,
            seq: nextSeq,
            role,
            content: trimmed,
          });
        }

        if (conditionCode !== "CTRL") {
          await noteHumanMessageArrival({
            sessionCode,
            messageSeq: nextSeq,
            conversationEpoch: humanTurn.conversationEpoch,
            content: trimmed,
          });
        }

        await ledgerTurn?.waitForPrior;
        if (conditionCode !== "CTRL" && trimmed.length >= 15) {
          try {
            // The ledger for this message must be committed before routing and
            // judging it. The previous fire-and-forget path let the judge read
            // stale coverage and classify already-spoken traits as unsurfaced.
            const ids = await extractSurfacedTraits(trimmed);
            const [newCount] = await Promise.all([
              updateRevealStats(sessionId, ids, nextSeq),
              ids.length
                ? Message.updateOne(
                    { _id: savedMessage._id },
                    { $addToSet: { sharedInfoIds: { $each: ids } } },
                  )
                : Promise.resolve(),
            ]);
            if (ids.length) {
              traceTurnEvent({
                sessionId: sessionId.toString(),
                seq: nextSeq,
                detail: `coverage: surfaced ${ids.length}, newly recorded ${newCount}`,
              });
            }
          } catch (error) {
            log.error("[pooling] extract error:", error);
          }
        }
        ledgerTurn?.release();
        ledgerTurn = undefined;
        if (conditionCode !== "CTRL") {
          const explicitDefer = detectExplicitAlexDefer(trimmed);
          enqueueConversationObservation({
            sessionId,
            anchorSeq: nextSeq,
            conversationEpoch: humanTurn.conversationEpoch,
            explicitAlexDefer: explicitDefer.deferred,
            explicitAlexDeferEvidence:
              explicitDefer.evidence === "none" ? undefined : explicitDefer.evidence,
          });
          void onHumanMessage({
            sessionCode,
            messageSeq: nextSeq,
            conversationEpoch: humanTurn.conversationEpoch,
            content: trimmed,
          }).catch((error) => log.error("[push-v2] turn error:", error));
        }
      } catch (error) {
        log.error("[socket] send-message error:", error);
        socket.emit("message-failed", { reason: "Server error while saving message" });
      } finally {
        ledgerTurn?.release();
      }
    });

    socket.on("typing", ({ isTyping }) => {
      const { sessionCode, role } = socket.data;
      if (!sessionCode || !role) return;
      socket.to(sessionCode).emit("peer-typing", { role, isTyping });
    });

    socket.on("disconnect", async (reason) => {
      log.debug(`[socket] disconnected: ${socket.id} (${reason})`);
      const { sessionCode, role, participantCode, sessionId } = socket.data;
      if (!sessionCode || !role) return;
      socket.to(sessionCode).emit("peer-disconnected", { role });
      log.info(`[session] ${role} left ${sessionCode}`);
      if (presentRoles(io, sessionCode).size === 0) pauseInterventionSession(sessionCode);
      if (participantCode && sessionId) {
        try {
          await Participant.findOneAndUpdate(
            { sessionId, participantCode },
            { lastSeenAt: new Date() },
          );
        } catch (error) {
          log.error("[socket] failed to update lastSeenAt:", error);
        }
      }
    });
  });
}
