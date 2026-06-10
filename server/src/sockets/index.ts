import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { buildSessionContext, evaluateTriggers } from "../triggers/evaluate.js";
import { handleAITurn } from "../lib/aiTurn.js";
import { LEADER_OPENING } from "../lib/prompts.js";
import { judgeIntervention, JUDGE_WINDOW_SIZE } from "../lib/interventionJudge.js";
import { computeCue, ADDRESS_RE } from "../lib/computeCue.js";
import { extractSurfacedTraits } from "../lib/poolingExtractor.js";
import { updateRevealStats, computeTally } from "../lib/poolingTally.js";
import type { Cand } from "../lib/traitData.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import type { Trigger } from "../triggers/types.js";
import type { ConditionCode } from "../types.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

const sessionIntervals = new Map<string, NodeJS.Timeout>();

// ── Step 4/B: 타이머 기반 leader closing 게이트 ──────────────────
const sessionStartedAt = new Map<string, number>(); // sessionCode → startedAt(ms)
const closingDone = new Set<string>(); // sessionCode (closing 1회 가드)
const openingDone = new Set<string>(); // sessionCode (오프닝 1회 가드)
// ── Step 15/Phase 2: leader 중간정리 마일스톤 상태 ─────────────────
const lastSummaryLeader = new Map<string, Cand>(); // sessionCode → 직전 summary 때의 선두
const lastSummaryAt = new Map<string, number>(); // sessionCode → 직전 summary의 lastMessageSeq
const SUMMARY_COOLDOWN_TURNS = 4;
const SUMMARY_TRIGGER: Trigger = { name: "summary", shouldFire: () => false };
const CLOSING_TRIGGER: Trigger = { name: "closing", shouldFire: () => false };
const ADDRESS_TRIGGER: Trigger = { name: "address", shouldFire: () => false };
const JUDGE_TRIGGER: Trigger = { name: "judge", shouldFire: () => false };
const SILENCE_TRIGGER: Trigger = { name: "long-silence", shouldFire: () => false };

async function insertLeaderOpening(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
) {
  if (conditionCode !== "C2" && conditionCode !== "C4") return;
  if (openingDone.has(sessionCode)) return;
  openingDone.add(sessionCode);

  const lastMsg = await Message.findOne({ sessionId }).sort({ seq: -1 });
  const seq = (lastMsg?.seq ?? 0) + 1;
  const msg = await Message.create({
    sessionId,
    sender: "ai",
    senderRole: "ai",
    content: LEADER_OPENING,
    seq,
    sharedInfoIds: [],
  });
  io.to(sessionCode).emit("new-message", {
    seq: msg.seq,
    sender: msg.sender,
    senderRole: msg.senderRole,
    content: msg.content,
    createdAt: (msg as any).createdAt.toISOString(),
  });
  await AIIntervention.create({
    sessionId,
    turnIndex: 0,
    triggerReason: "opening",
    cue: "opening",
    decision: "speak",
    generateMessageId: msg._id,
    response: LEADER_OPENING,
  });
  console.log(`[opening] leader opening inserted for ${sessionCode}`);
}

async function loadWindow(sessionId: string) {
  const recent = await Message.find({ sessionId }).sort({ seq: -1 }).limit(JUDGE_WINDOW_SIZE);
  const asc = recent.reverse();
  const label = (r: string) => (r === "ai" ? "Alex" : r === "humanX" ? "Member 1" : "Member 2");
  return {
    labeled: asc.map((m) => ({ speaker: label(m.senderRole), content: m.content })),
    cue: asc.map((m) => ({ sender: m.sender, content: m.content })),
  };
}

// 게이트 + 개입 judge — pull·push 분리 (pull=long-silence 안전망, push=judge).
// leader(C2/C4) 조건에서 토론 종료 CLOSING_LEAD_MS 전부터 일반 트리거를 차단하고 closing 턴 1회.
async function maybeAITurn(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
  source: "push" | "pull",
) {
  // ── leader closing 게이트 ──
  const isLeader = conditionCode === "C2" || conditionCode === "C4";
  const startedMs = sessionStartedAt.get(sessionCode);
  if (isLeader && startedMs !== undefined) {
    const timeLeftMs = startedMs + TRIGGER_CONFIG.DISCUSSION_DURATION_MS - Date.now();
    if (timeLeftMs <= TRIGGER_CONFIG.CLOSING_LEAD_MS) {
      if (!closingDone.has(sessionCode)) {
        closingDone.add(sessionCode);
        const ctx = await buildSessionContext(sessionId, sessionCode);
        await handleAITurn(io, sessionCode, sessionId, CLOSING_TRIGGER, ctx, conditionCode, {
          closing: true,
        });
        console.log(`[closing] fired for ${sessionCode}`);
      }
      return;
    }
  }

  const ctx = await buildSessionContext(sessionId, sessionCode);

  // ① 호명 fast-path (push·pull 공통, judge보다 우선·결정적)
  if (!ctx.lastMessageIsAI && ADDRESS_RE.test(ctx.lastMessageText)) {
    console.log(`[gate] address (session=${sessionCode})`);
    await handleAITurn(io, sessionCode, sessionId, ADDRESS_TRIGGER, ctx, conditionCode, {
      reason: "directed_followup",
    });
    return;
  }

  // ② pre-filter: AI 발화 후 새 사람 메시지 없으면 아무것도 안 함
  if (ctx.messagesSinceLastAI < 1) return;

  // ②.5 leader 중간정리 마일스톤 (Step 15/Phase 2) — push만 · leader 전용 · 선두 변화 + 쿨다운.
  // hidden profile에선 초반 A=B=D 동률(leader=null) → 보통 C가 추월하는 순간 딱 1회 발동.
  if (source === "push" && isLeader) {
    const s = await Session.findById(sessionId).select("revealStats").lean();
    const tally = computeTally((s as any)?.revealStats);
    const prev = lastSummaryLeader.get(sessionCode);
    const cooled =
      ctx.lastMessageSeq - (lastSummaryAt.get(sessionCode) ?? -Infinity) >= SUMMARY_COOLDOWN_TURNS;
    if (tally.leader !== null && tally.leader !== prev && cooled) {
      lastSummaryLeader.set(sessionCode, tally.leader);
      lastSummaryAt.set(sessionCode, ctx.lastMessageSeq);
      console.log(`[gate] leader summary (session=${sessionCode}, leader=${tally.leader})`);
      await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx, conditionCode, {
        summary: true,
      });
      return;
    }
  }

  if (source === "pull") {
    // ③ pull = long-silence 안전망만 (결정적, judge·messageCount 없음)
    if (
      ctx.secondsSinceLastMessage !== null &&
      ctx.secondsSinceLastMessage >= TRIGGER_CONFIG.LONG_SILENCE_SECONDS
    ) {
      const win = await loadWindow(sessionId);
      const reason = computeCue({ messages: win.cue, phase: "main" });
      console.log(`[gate] long-silence safety (session=${sessionCode})`);
      await handleAITurn(io, sessionCode, sessionId, SILENCE_TRIGGER, ctx, conditionCode, {
        reason,
      });
    }
    return;
  }

  // ④ push = 개입 judge (조건-블라인드)
  const win = await loadWindow(sessionId);
  const decision = await judgeIntervention(win.labeled, ctx.messagesSinceLastAI);
  if (decision === null) {
    const fired = await evaluateTriggers(ctx);
    if (fired) await handleAITurn(io, sessionCode, sessionId, fired, ctx, conditionCode);
    return;
  }
  console.log(
    `[judge] speak=${decision.speak} reason=${decision.reason} why="${decision.why}" (session=${sessionCode})`,
  );
  if (decision.speak) {
    // peer(C1/C3)는 mediation을 하지 않는다(리더 전용 행동) → 침묵(자연스럽게 덜 말함) — Step 12/결함 4
    if (decision.reason === "mediation" && (conditionCode === "C1" || conditionCode === "C3")) {
      console.log(`[gate] peer mediation suppressed → silent (session=${sessionCode})`);
      return;
    }
    if (decision.reason === "social") {
      // social: 전용 SOCIAL_PROMPT로 분기 (task cue 미주입, 조건 무관 통제). transcript로 맥락 반영.
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        social: true,
      });
    } else if (decision.reason === "react") {
      // react: 전용 buildReactPrompt로 분기 (Step 13) — 가벼운 ack, task cue 미주입.
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        react: true,
      });
    } else {
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        reason: decision.reason,
      });
    }
  }
}

function startPullEvalution(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
) {
  if (sessionIntervals.has(sessionCode)) return;

  const interval = setInterval(() => {
    maybeAITurn(io, sessionCode, sessionId, conditionCode, "pull").catch((e) =>
      console.error("[pull] turn error:", e),
    );
  }, TRIGGER_CONFIG.PULL_EVALUATION_INTERVAL_MS);
  sessionIntervals.set(sessionCode, interval);
  console.log(`[pull-trigger] started for ${sessionCode}`);
}

function stopPullEvalution(sessionCode: string) {
  const interval = sessionIntervals.get(sessionCode);
  if (interval) {
    clearInterval(interval);
    sessionIntervals.delete(sessionCode);
    console.log(`[pull-trigger] stopped for ${sessionCode}`);
  }
  // closing/summary 게이트 상태 정리 (메모리 누수 방지)
  sessionStartedAt.delete(sessionCode);
  closingDone.delete(sessionCode);
  openingDone.delete(sessionCode);
  lastSummaryLeader.delete(sessionCode);
  lastSummaryAt.delete(sessionCode);
}

export function registerSocketHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on("join-session", async ({ sessionCode, participantCode }) => {
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
        socket.data.conditionCode = session.conditionCode as ConditionCode;

        console.log(
          `[socket] ${socket.id} (${participant.role}) joined ${sessionCode} (${currentSize + 1}/${maxParticipants}) ${isReconnect ? "[reconnected]" : ""}`,
        );

        // 7. 세션 전체 메시지 전송

        const allMessages = await Message.find({ sessionId: session._id }).sort({ seq: 1 });
        socket.emit("session-history", {
          messages: allMessages.map((m) => ({
            seq: m.seq,
            sender: m.sender,
            senderRole: m.senderRole,
            content: m.content,
            createdAt: (m as any).createdAt.toISOString(),
          })),
        });
        console.log(`[socket] sent ${allMessages.length} history messages to ${participant.role}`);

        //8. 재접속 알림
        if (isReconnect) {
          socket.to(sessionCode).emit("peer-reconnected", { role: participant.role });
          console.log(
            `[reconnect] ${participant.role} session=${sessionCode} at=${new Date().toISOString()}`,
          );
        }

        // 9. 정원 다 차면 전원에게 ready 이벤트 전송 (broadcast) - 신규 입장일때만
        const newSize = currentSize + 1;
        if (newSize >= maxParticipants && !isReconnect) {
          //status: waiting -> in_progress
          if (session.status === "waiting") {
            session.status = "in_progress";
            session.startedAt = new Date();
            await session.save();
            console.log(`[socket] session ${sessionCode} status: waiting -> in_progress`);
          }
          // closing 게이트용 시작 시각 보관 (Step 4/B)
          if (session.startedAt) {
            sessionStartedAt.set(sessionCode, session.startedAt.getTime());
          }
          io.to(sessionCode).emit("session-ready", { sessionCode, participantCount: newSize });
          if (session.conditionCode !== "CTRL") {
            startPullEvalution(
              io,
              sessionCode,
              session._id.toString(),
              session.conditionCode as ConditionCode,
            );
            await insertLeaderOpening(
              io,
              sessionCode,
              session._id.toString(),
              session.conditionCode as ConditionCode,
            );
          }
        }
      } catch (error) {
        console.error("[socket] join-session error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });

    //---join-waiting: 대기방 입장---
    socket.on("join-waiting", async ({ sessionCode, participantCode }) => {
      try {
        //1. 세션 조회
        const session = await Session.findOne({ sessionCode });
        if (!session) {
          socket.emit("join-error", { reason: "Session not found" });
          return;
        }

        //2. 참가자 조회
        const participant = await Participant.findOne({ sessionId: session._id, participantCode });
        if (!participant) {
          socket.emit("join-error", { reason: "Participant not registered" });
          return;
        }

        //3. waiting room 입장 (ChatRoom과 분리하기 위해 prefix사용)
        const waitingRoom = `waiting:${sessionCode}`;
        await socket.join(waitingRoom);

        //4. lastSeenAt 갱신
        await Participant.updateOne({ _id: participant._id }, { $set: { lastSeenAt: new Date() } });

        //5. 현재 대기실 인원 확인
        const room = io.sockets.adapter.rooms.get(waitingRoom);
        const participantsReady = room?.size ?? 0;
        const expected = session.conditionCode === "CTRL" ? 3 : 2;

        console.log(
          `[socket] join-waiting: ${sessionCode}, ${participantCode}, ${participantsReady}/${expected}`,
        );

        //6. 모두에게 현재 인원 broadcast
        io.to(waitingRoom).emit("waiting-update", { participantsReady, expected });

        //7. 정원 차면 both-ready emit
        if (participantsReady >= expected) {
          io.to(waitingRoom).emit("both-ready", { sessionCode });
          console.log(`[socket] both-ready: ${sessionCode}`);
        }
      } catch (error) {
        console.error("[socket] join-waiting error:", error);
        socket.emit("join-error", { reason: "Internal server error" });
      }
    });

    socket.on("send-message", async ({ content }) => {
      try {
        //1. socket.data 검증
        const { sessionCode, sessionId, participantCode, role, conditionCode } = socket.data;
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
          createdAt: savedMessage.createdAt.toISOString(),
        });

        // pooling 추출 (Step 14a) — 사람 메시지만, fire-and-forget (응답경로 안 막음). 짧은 잡담은 skip.
        if (conditionCode !== "CTRL" && trimmed.length >= 15) {
          void extractSurfacedTraits(trimmed)
            .then((ids) => {
              if (ids.length) console.log(`[pooling] surfaced ${JSON.stringify(ids)} (session=${sessionCode})`);
              return updateRevealStats(sessionId, ids);
            })
            .catch((e) => console.error("[pooling] extract error:", e));
        }

        //6. Push 트리거 평가 - AI 호출은 비동기 (핸들러 안 막음)
        if (conditionCode !== "CTRL") {
          maybeAITurn(io, sessionCode, sessionId, conditionCode as ConditionCode, "push").catch(
            (e) => console.error("[push] turn error:", e),
          );
        }
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
