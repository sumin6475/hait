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
import { updateRevealStats, computeTally, countSurfaced } from "../lib/poolingTally.js";
import type { Cand } from "../lib/traitData.js";
import { allocSeq } from "../lib/seq.js";
import type { SessionContext } from "../triggers/types.js";
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
const CLOSING_TRIGGER: Trigger = { name: "closing", shouldFire: () => false };
const ADDRESS_TRIGGER: Trigger = { name: "address", shouldFire: () => false };
const JUDGE_TRIGGER: Trigger = { name: "judge", shouldFire: () => false };
const SILENCE_TRIGGER: Trigger = { name: "long-silence", shouldFire: () => false };
// ── Step 16/Part B: peer mediation 침묵 하한선 ─────────────────────
const PEER_MEDIATION_FLOOR_K = 5; // peer mediation 연속 억제 상한 — 이만큼 연속 묵으면 1회 open_floor로 풀어줌
const peerMediationStreak = new Map<string, number>(); // sessionCode → 연속 peer-mediation 억제 횟수
const PEER_FLOOR_TRIGGER: Trigger = { name: "peer-mediation-floor", shouldFire: () => false };
// ── Step 22: leader summary (중간정리) 게이트 상태 ─────────────────
const summaryPrevLeader = new Map<string, Cand | null>(); // 직전 체크 시 1등 (전이 감지)
const summaryArmedLeader = new Map<string, Cand>(); // 안정성 대기 중인 새 1등 (가드②)
const lastSummaryAtSeq = new Map<string, number>(); // 마지막 summary 시점 seq (가드③ 쿨다운)
const lastSummaryLeader = new Map<string, Cand>(); // 마지막 summary가 선언한 1등 (wobble 컨텍스트·재정리 방지)
const SUMMARY_TRIGGER: Trigger = { name: "summary", shouldFire: () => false };
const SUMMARY_MIN_SURFACED = 8; // ① 표면화된 distinct trait 최소 (총 40 중) — 초반 성급 차단
const SUMMARY_COOLDOWN_MSGS = 8; // ③ 마지막 summary 후 최소 사람+AI 메시지 수 (≈4~5턴)
// ② 안정성 = "한 박자" = 전이 후 다음 체크에도 같은 1등이면 발동 (armedLeader 메커니즘)

// ── Step 21: judge 개입 이력 (soft anti-repeat용) ──────────────────
// GroupGPT(Shen et al. 2026)의 judge 입력 포맷 이식 — 직전 개입 reason을 judge가 보게 한다.
const RECENT_REASONS_K = 4; // judge에 보여줄 최근 발화 reason 개수
const recentReasons = new Map<string, string[]>(); // sessionCode → 오래된→최신 (최대 K)
function pushReason(sessionCode: string, reason: string) {
  const arr = recentReasons.get(sessionCode) ?? [];
  arr.push(reason);
  while (arr.length > RECENT_REASONS_K) arr.shift();
  recentReasons.set(sessionCode, arr);
}

async function insertLeaderOpening(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
) {
  if (conditionCode !== "C2" && conditionCode !== "C4") return;
  if (openingDone.has(sessionCode)) return;
  openingDone.add(sessionCode);

  const seq = await allocSeq(sessionId); // 원자 발급 (Step 18)
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

// judge가 침묵을 택한 평가를 1행 영속 (stay_silent) — Step 20. 응답경로 안 막게 fire-and-forget.
// 기계적 게이트(pre-filter/anti-double-post 등)는 판단이 아니라 기록하지 않는다.
function logSilence(
  sessionId: string,
  turnIndex: number,
  triggerReason: string,
  cue: string,
  why: string,
) {
  void AIIntervention.create({
    sessionId,
    turnIndex,
    triggerReason,
    cue,
    decision: "stay_silent",
    why,
  }).catch((e) => console.error("[silence-log] failed:", e));
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

// 최근(Alex 발화 이후) 미답 호명 스캔 (Step 22/A-4, thin) — 호명이 마지막 메시지면 address fast-path가
// 먼저 잡으므로, 이 스캔은 "호명 뒤에 다른 사람 메시지가 와서 호명이 마지막이 아닌" 엣지 보강.
async function hasUnansweredAddress(sessionId: string): Promise<boolean> {
  const win = await loadWindow(sessionId);
  const msgs = win.cue;
  let lastAi = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.sender === "ai") {
      lastAi = i;
      break;
    }
  }
  return msgs.slice(lastAi + 1).some((m) => m.sender !== "ai" && ADDRESS_RE.test(m.content));
}

// ── Step 22: leader summary 게이트 (leader 전용, judge 우회·결정적) ──
// 전이 = computeTally().leader가 단독(non-null)이고 직전 체크와 다름. 가드: ①충분히 쌓임 ②한 박자 안정 ③쿨다운 + A-4 양보.
// pre-filter 뒤에서 호출되므로 직전 메시지는 항상 사람 → handleAITurn 더블포스트 가드를 그대로 존중(예외 없음).
async function maybeLeaderSummary(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
  ctx: SessionContext,
): Promise<boolean> {
  const sess = await Session.findById(sessionId).select("revealStats").lean();
  const rs = (sess as any)?.revealStats;
  const cur = computeTally(rs).leader; // Cand | null

  const prev = summaryPrevLeader.get(sessionCode) ?? null;
  summaryPrevLeader.set(sessionCode, cur); // 매 체크 갱신

  // 전이 후보: 현재 단독 1등이고, 직전과 다름 (T2: 후보교체 / T4: 동률→단독)
  const isTransition = cur !== null && cur !== prev;
  if (!isTransition) {
    summaryArmedLeader.delete(sessionCode);
    return false;
  }

  // 가드② 안정성("한 박자"): 같은 새 1등이 연속 2회 확인돼야 발동
  if (summaryArmedLeader.get(sessionCode) !== cur) {
    summaryArmedLeader.set(sessionCode, cur); // 이번엔 무장만, 발동 X
    return false;
  }

  // 가드① 충분히 쌓임
  if (countSurfaced(rs) < SUMMARY_MIN_SURFACED) return false;

  // 가드③ 쿨다운
  const lastAt = lastSummaryAtSeq.get(sessionCode) ?? -Infinity;
  if (ctx.lastMessageSeq - lastAt < SUMMARY_COOLDOWN_MSGS) return false;

  // A-4 양보: 최근 미답 호명이 있으면 summary 보류 (address가 먼저 처리되게)
  if (await hasUnansweredAddress(sessionId)) {
    console.log(`[gate] summary deferred → unanswered address (session=${sessionCode})`);
    return false;
  }

  // 발동
  summaryArmedLeader.delete(sessionCode);
  lastSummaryAtSeq.set(sessionCode, ctx.lastMessageSeq);
  lastSummaryLeader.set(sessionCode, cur);
  const transition = prev === null ? "T4(tie→solo)" : `T2(${prev}→${cur})`;
  console.log(`[gate] leader summary (leader=${cur}, ${transition}, session=${sessionCode})`);
  await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx, conditionCode, {
    summary: true,
    summaryLeader: cur,
    summaryTransition: transition,
  });
  return true;
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
        peerMediationStreak.set(sessionCode, 0); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
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
    peerMediationStreak.set(sessionCode, 0); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
    pushReason(sessionCode, "directed_followup"); // Step 21
    await handleAITurn(io, sessionCode, sessionId, ADDRESS_TRIGGER, ctx, conditionCode, {
      reason: "directed_followup",
      recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
    });
    return;
  }

  // ② pre-filter: AI 발화 후 새 사람 메시지 없으면 아무것도 안 함
  if (ctx.messagesSinceLastAI < 1) return;

  // ②.5 [Step 22] leader summary 게이트 (leader 전용, judge 우회·결정적)
  if (isLeader) {
    const fired = await maybeLeaderSummary(io, sessionCode, sessionId, conditionCode, ctx);
    if (fired) return; // summary 발화함 → 이번 사이클 종료
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
      peerMediationStreak.set(sessionCode, 0); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
      pushReason(sessionCode, reason); // Step 21
      await handleAITurn(io, sessionCode, sessionId, SILENCE_TRIGGER, ctx, conditionCode, {
        reason,
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
      });
    }
    return;
  }

  // ④ push = 개입 judge (조건-블라인드)
  const win = await loadWindow(sessionId);
  const decision = await judgeIntervention(
    win.labeled,
    ctx.messagesSinceLastAI,
    recentReasons.get(sessionCode) ?? [],
  );
  if (decision === null) {
    const fired = await evaluateTriggers(ctx);
    if (fired) {
      peerMediationStreak.set(sessionCode, 0); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
      await handleAITurn(io, sessionCode, sessionId, fired, ctx, conditionCode, {
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
      });
    }
    return;
  }
  console.log(
    `[judge] speak=${decision.speak} reason=${decision.reason} why="${decision.why}" (session=${sessionCode})`,
  );
  if (decision.speak) {
    // peer(C1/C3)는 mediation(리더 전용 행동)을 하지 않는다 → 기본은 침묵.
    // 단, 연속 억제가 K회에 달하면 영영 묵게 두지 않고 그 1회를 open_floor(본인 read)로 풀어준다 — Step 16/고려사항2
    if (decision.reason === "mediation" && (conditionCode === "C1" || conditionCode === "C3")) {
      const streak = (peerMediationStreak.get(sessionCode) ?? 0) + 1;
      if (streak < PEER_MEDIATION_FLOOR_K) {
        peerMediationStreak.set(sessionCode, streak);
        console.log(
          `[gate] peer mediation suppressed → silent (streak=${streak}/${PEER_MEDIATION_FLOOR_K}, session=${sessionCode})`,
        );
        logSilence(sessionId, ctx.lastMessageSeq, "peer-mediation-suppressed", "mediation", decision.why); // Step 20 — 조건 효과 분석용
        return;
      }
      // 하한선 도달: mediation 대신 peer 본인 read를 open_floor로 1회 내보냄 + 카운터 리셋
      peerMediationStreak.set(sessionCode, 0);
      console.log(
        `[gate] peer mediation floor reached (streak=${streak}) → remap to open_floor (session=${sessionCode})`,
      );
      pushReason(sessionCode, "open_floor"); // Step 21
      await handleAITurn(io, sessionCode, sessionId, PEER_FLOOR_TRIGGER, ctx, conditionCode, {
        reason: "open_floor",
      });
      return;
    }
    peerMediationStreak.set(sessionCode, 0); // mediation 억제 통과 = 실제 발화 확정 → 연속 억제 끊김 (Step 16/B-3)
    pushReason(sessionCode, decision.reason); // Step 21 — judge 발화 전부 (social/react/task 공통)
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
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
      });
    }
  } else {
    // Step 20: 평가받고 침묵한 결정 영속 (개입 타이밍 분석용)
    logSilence(sessionId, ctx.lastMessageSeq, "judge", decision.reason, decision.why);
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
  // closing 게이트 상태 정리 (메모리 누수 방지)
  sessionStartedAt.delete(sessionCode);
  closingDone.delete(sessionCode);
  openingDone.delete(sessionCode);
  peerMediationStreak.delete(sessionCode);
  recentReasons.delete(sessionCode);
  summaryPrevLeader.delete(sessionCode);
  summaryArmedLeader.delete(sessionCode);
  lastSummaryAtSeq.delete(sessionCode);
  lastSummaryLeader.delete(sessionCode);
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

        //3. seq 부여 - 세션 카운터에서 원자 발급 (Step 18, read-max-then-+1 레이스 제거)
        const nextSeq = await allocSeq(sessionId);

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
