import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { buildSessionContext, evaluateTriggers } from "../triggers/evaluate.js";
import { handleAITurn } from "../lib/aiTurn.js";
import { LEADER_OPENING, PEER_OPENING } from "../lib/prompts.js";
import { getSessionLang, KO_LEADER_OPENING, KO_PEER_OPENING } from "../lib/koPilot.js"; // [KO-PILOT]
import { judgeIntervention, JUDGE_WINDOW_SIZE } from "../lib/interventionJudge.js";
import { computeCue, ADDRESS_RE } from "../lib/computeCue.js";
import { extractSurfacedTraits } from "../lib/poolingExtractor.js";
import {
  updateRevealStats,
  computeTally,
  countSurfaced,
  leastCoveredCandidate,
  floorMet, // [Step 45] 수렴 양면 floor
} from "../lib/poolingTally.js";
import { aiDisplayName, PARTICIPANT_LABEL } from "../lib/labels.js";
import type { Cand } from "../lib/traitData.js";
import { allocSeq } from "../lib/seq.js";
import type { SessionContext } from "../triggers/types.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import type { Trigger } from "../triggers/types.js";
import type { ConditionCode, ParticipantRole } from "../types.js";
import { log } from "../lib/log.js";
import { FOLLOWUP_WINDOW, isFollowupToAlex } from "../lib/followupJudge.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

// ── Step 23: 역할 기반 세션 시작 헬퍼 ──────────────────────────────
// 방(sessionCode 또는 waiting:sessionCode) 안에 현재 들어와 있는 distinct 역할 집합
function presentRoles(io: IO, roomName: string): Set<string> {
  const room = io.sockets.adapter.rooms.get(roomName);
  const roles = new Set<string>();
  if (room) {
    for (const sid of room) {
      const r = io.sockets.sockets.get(sid)?.data?.role;
      if (r) roles.add(r);
    }
  }
  return roles;
}
function requiredRolesFor(conditionCode: string): ParticipantRole[] {
  return conditionCode === "CTRL" ? ["humanX", "humanY", "humanZ"] : ["humanX", "humanY"];
}

const sessionIntervals = new Map<string, NodeJS.Timeout>();

// ── Step 4/B: 타이머 기반 leader closing 게이트 ──────────────────
const sessionStartedAt = new Map<string, number>(); // sessionCode → startedAt(ms)
const closingDone = new Set<string>(); // sessionCode (closing 1회 가드)
const openingDone = new Set<string>(); // sessionCode (오프닝 1회 가드)
const CLOSING_TRIGGER: Trigger = { name: "closing", shouldFire: () => false };
const JUDGE_TRIGGER: Trigger = { name: "judge", shouldFire: () => false };
const SILENCE_TRIGGER: Trigger = { name: "long-silence", shouldFire: () => false };
// ── [Step 37] Summary 게이트 — 단순 트리거(전이/armed/쿨다운 제거). 세션 1회. ──
const lastSummaryAtSeq = new Map<string, number>(); // 마지막 summary 시점 seq (callout spacing 읽기용 잔존)
const lastSummaryLeader = new Map<string, Cand>(); // 마지막 summary가 선언한 1등 (task 턴 wobble 컨텍스트)
const summaryDone = new Set<string>(); // sessionCode (세션 1회 가드 = 큰 간격의 최단형)
const SUMMARY_TRIGGER: Trigger = { name: "summary", shouldFire: () => false };
const SUMMARY_MIN_SURFACED = 8; // ① 표면화된 distinct trait 최소 — 초반 성급 차단
const SUMMARY_AFTER_MSGS = 12; // ② 토론 경과 (총 메시지) — 초반 차단

// ── [Step 45] 수렴 소진 추적 (leader 조기-closing 게이트) ──
const lastSurfacedCount = new Map<string, number>(); // 마지막으로 관측한 표면화 distinct 총수
const lastGrowthSeq = new Map<string, number>(); // 그 총수가 마지막으로 증가한 시점 seq

// ── [Step 30] leader 지목 호명 overlay (G1·G2·G3만 — Step 37서 G4·G5·G6 제거) ──
const CALLOUT_MAX_PER_SESSION = 2; // G1 세션 상한
const CALLOUT_COOLDOWN_MSGS = 8; // G2 지목 간 최소 메시지
const calloutCount = new Map<string, number>();
const lastCalloutAtSeq = new Map<string, number>();
const lastCalloutTarget = new Map<string, ParticipantRole>(); // G3 무응답 잠금용

// [Step 48] leader 전용 → 모든 AI 조건으로 확장. status가 오프닝의 "종류"를 가른다:
// leader(C2/C4)는 의제를 열고, peer(C1/C3)는 인사만 한다. CTRL은 AI가 없어 여기서 반환.
async function insertOpening(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
) {
  if (conditionCode === "CTRL") return;
  if (openingDone.has(sessionCode)) return;
  openingDone.add(sessionCode); // [Step 27-A] await 前 동기 클레임 — 동시 진입 봉쇄 (Node 단일스레드: has↔add 사이 양보 없음)
  // [Step 26-B] 영속 가드(목적 유지): 서버 재시작 후 in_progress 재접속 시 재삽입 방지
  if (await Message.exists({ sessionId })) return;

  try {
    const isLeader = conditionCode === "C2" || conditionCode === "C4";
    const lang = await getSessionLang(sessionId); // [KO-PILOT]
    const opening = isLeader // [Step 48]
      ? lang === "ko"
        ? KO_LEADER_OPENING
        : LEADER_OPENING // [KO-PILOT]
      : lang === "ko"
        ? KO_PEER_OPENING
        : PEER_OPENING;
    const seq = await allocSeq(sessionId); // 원자 발급 (Step 18)
    const msg = await Message.create({
      sessionId,
      sender: "ai",
      senderRole: "ai",
      content: opening,
      seq,
      sharedInfoIds: [],
    });
    // 오프닝 broadcast만 1초 지연 — 입장 직후 갑자기 뜨지 않고 자연스럽게 등장 (DB 저장은 이미 완료 → 새로고침 내성 유지)
    setTimeout(() => {
      io.to(sessionCode).emit("new-message", {
        seq: msg.seq,
        sender: msg.sender,
        senderRole: msg.senderRole,
        content: msg.content,
        createdAt: (msg as any).createdAt.toISOString(),
      });
    }, 1000);
    await AIIntervention.create({
      sessionId,
      turnIndex: 0,
      triggerReason: "opening",
      cue: "opening",
      decision: "speak",
      generateMessageId: msg._id,
      response: opening, // [KO-PILOT] ko면 한국어 오프닝
    });
    log.info(`[opening] ${isLeader ? "leader" : "peer"} opening inserted for ${sessionCode}`);
  } catch (e) {
    openingDone.delete(sessionCode); // 삽입 실패 시 클레임 롤백 — 클레임만 남고 오프닝 없는 세션 방지
    throw e;
  }
}

// judge가 침묵을 택한 평가를 1행 영속 (stay_silent) — Step 20. 응답경로 안 막게 fire-and-forget.
// 기계적 게이트(pre-filter/anti-double-post 등)는 판단이 아니라 기록하지 않는다.
// [Step 29] 주의: 침묵 reason 분포는 Step 28 전/후 비교 불가 — 28-A가 false∧mediation을
// 제거(의도된 변화). 본실험 데이터는 전부 Step 28+ 코드 기준이라 실험 내 일관성은 유지됨.
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
  }).catch((e) => log.error("[silence-log] failed:", e));
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

// 최근(Alex 발화 이후) 미답 호명 스캔 (Step 22/A-4, thin) — Step 54부터 호명은 쿨다운만 면제되고
// judge까지 내려가므로, summary가 그 전에 가로채지 않게 최근 창 전체를 확인한다.
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

// ── [Step 37] leader summary 게이트 (leader 전용, 단순 트리거) ──
// 전이/armed/쿨다운 제거. 가드: ①충분히 쌓임 ②토론 경과 ③세션 1회 + 호명 양보.
// leader=computeTally().leader(Cand|null)는 내용일 뿐 발동을 막지 않음 — null이면 박빙 분기(§5D, T-C4-010 수정).
// pre-filter 뒤에서 호출되므로 직전 메시지는 항상 사람 → handleAITurn 더블포스트 가드를 그대로 존중.
async function maybeLeaderSummary(
  io: IO,
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
  ctx: SessionContext,
): Promise<boolean> {
  if (summaryDone.has(sessionCode)) return false; // ③ 세션 1회
  const sess = await Session.findById(sessionId).select("revealStats").lean();
  const rs = (sess as any)?.revealStats;
  if (countSurfaced(rs) < SUMMARY_MIN_SURFACED) return false; // ① 정보 충분
  if (ctx.totalMessageCount < SUMMARY_AFTER_MSGS) return false; // ② 토론 경과
  if (await hasUnansweredAddress(sessionId)) {
    log.info(`[gate] summary deferred → unanswered address (session=${sessionCode})`);
    return false;
  }

  const leader = computeTally(rs).leader; // Cand | null — 발동 막지 않음
  summaryDone.add(sessionCode);
  lastSummaryAtSeq.set(sessionCode, ctx.lastMessageSeq);
  if (leader) lastSummaryLeader.set(sessionCode, leader); // wobble: leader≠null일 때만 (동률 뒤엔 강제할 1등 없음)

  // [Step 43] 직전 메시지가 질문이면 summary가 가로채지 않게 답 → summary 2연속.
  // 호명은 위 hasUnansweredAddress 가드가 먼저 보류하므로 ADDRESS_RE는 방어적으로 유지.
  const pendingQ =
    !ctx.lastMessageIsAI &&
    (/\?\s*$/.test(ctx.lastMessageText) || ADDRESS_RE.test(ctx.lastMessageText));
  if (pendingQ) {
    log.info(`[gate] leader summary — answer→summary pair (leader=${leader ?? "tied"}, session=${sessionCode})`);
    // (1) 답 — directed_followup (EXP면 natural recipe로 자동). last가 사람이라 더블포스트 가드 자연 통과.
    await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
      reason: "directed_followup",
      recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
    });
    // 답 직후 transcript 변동 → ctx 재계산 (summary는 갱신된 맥락 기반)
    const ctx2 = await buildSessionContext(sessionId, sessionCode);
    // (2) summary — 자기 답 직후라 anti-double-post에 막히므로 그 가드만 면제 (cooldown은 이 경로에 없음)
    await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx2, conditionCode, {
      summary: true,
      summaryLeader: leader,
      bypassDoublePost: true,
    });
    return true;
  }

  log.info(`[gate] leader summary (leader=${leader ?? "tied"}, session=${sessionCode})`);
  await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx, conditionCode, {
    summary: true,
    summaryLeader: leader,
  });
  return true;
}

// ── [Step 30] 지목 호명 overlay 게이트 ──────────────────────────────
type CalloutOpts = { target: string; targetRole: ParticipantRole; cand?: Cand };

// callout 대상(WHOM)+cand 선정 — 순수 선정만 (G가드·상태변이는 호출부 책임). rs는 호출부가 로드해 전달.
async function pickCalloutTarget(
  sessionId: string,
  conditionCode: ConditionCode,
  rs: any,
): Promise<CalloutOpts> {
  // WHOM: 마지막 사람 발화자의 상대방 (2인 — humanX↔humanY). 사람 메시지 없으면 humanX 기본.
  const lastHuman = await Message.findOne({ sessionId, senderRole: { $ne: "ai" } })
    .sort({ seq: -1 })
    .select("senderRole")
    .lean();
  const targetRole: ParticipantRole =
    (lastHuman as any)?.senderRole === "humanX" ? "humanY" : "humanX";
  const target = PARTICIPANT_LABEL[targetRole];
  const cand = conditionCode === "C4" ? leastCoveredCandidate(rs) : undefined; // C4만 후보 지정
  return { target, targetRole, cand };
}

// 지목은 항상 '없어도 되는 장식' — 어떤 실패도 본 발화를 막지 않는다 (전체 try/catch → null).
async function maybeCalloutOverlay(
  sessionCode: string,
  sessionId: string,
  conditionCode: ConditionCode,
  ctx: SessionContext,
  reason: string,
): Promise<CalloutOpts | null> {
  try {
    // 트리거 매칭 (leader-only) — directed_followup 등은 여기서 걸러짐
    // [Step 31-④] C2: build_on ∪ mediation / C4: mediation
    const isC2 = conditionCode === "C2" && (reason === "build_on" || reason === "mediation");
    const isC4 = conditionCode === "C4" && reason === "mediation";
    if (!isC2 && !isC4) return null;

    // G1 상한 · G2 쿨다운
    if ((calloutCount.get(sessionCode) ?? 0) >= CALLOUT_MAX_PER_SESSION) return null;
    const lastAt = lastCalloutAtSeq.get(sessionCode);
    if (lastAt !== undefined && ctx.lastMessageSeq - lastAt < CALLOUT_COOLDOWN_MSGS) return null;

    // G3 무응답 잠금: 직전 지목 타깃이 그 후 한 마디도 안 했으면 재지목 전면 금지
    const prevTarget = lastCalloutTarget.get(sessionCode);
    if (prevTarget !== undefined && lastAt !== undefined) {
      const answered = await Message.exists({
        sessionId,
        senderRole: prevTarget,
        seq: { $gt: lastAt },
      });
      if (!answered) {
        log.debug(`[callout] held: unanswered previous callout (session=${sessionCode})`);
        return null;
      }
    }

    // WHOM/cand 선정 — 공유 헬퍼. (G4·G5·G6 제거 — Step 37)
    const sess = await Session.findById(sessionId).select("revealStats").lean();
    const rs = (sess as any)?.revealStats;
    const { target, targetRole, cand } = await pickCalloutTarget(sessionId, conditionCode, rs);

    // 상태 갱신은 발동 직전 1회 (summary 선례 — handleAITurn 내부 skip 시 1회 소모는 수용)
    calloutCount.set(sessionCode, (calloutCount.get(sessionCode) ?? 0) + 1);
    lastCalloutAtSeq.set(sessionCode, ctx.lastMessageSeq);
    lastCalloutTarget.set(sessionCode, targetRole);

    log.info(
      `[gate] callout overlay (target=${target}${cand ? `, cand=${cand}` : ""}, reason=${reason}, n=${calloutCount.get(sessionCode)}/${CALLOUT_MAX_PER_SESSION}, session=${sessionCode})`,
    );
    return { target, targetRole, cand };
  } catch (e) {
    log.error("[callout] overlay error (skipping callout, turn unaffected):", e);
    return null;
  }
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
  if (closingDone.has(sessionCode)) return; // [Step 36] close 1회(타이머 or 소진) 후 모든 게이트 무력화 — AI 영구 침묵
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
        log.info(`[closing] fired for ${sessionCode}`);
      }
      return;
    }
  }

  const ctx = await buildSessionContext(sessionId, sessionCode);

  // ① 말할 기회 판정 — 쿨다운 면제만 결정한다. reason은 judge(④)가 정한다.
  //    ①-a 이름 호명(정규식) · ①-b 이름 없는 팔로업(mini-judge, Alex 직후 1턴에만)
  let exempt = false;
  if (!ctx.lastMessageIsAI) {
    if (ADDRESS_RE.test(ctx.lastMessageText)) {
      exempt = true;
      log.info(`[gate] exempt: address src=${source} (session=${sessionCode})`);
    } else if (
      TRIGGER_CONFIG.EXP_FOLLOWUP_GATE &&
      ctx.messagesSinceLastAI === 1 &&
      source === "push"
    ) {
      const win = await loadWindow(sessionId);
      const yes = await isFollowupToAlex(win.labeled.slice(-FOLLOWUP_WINDOW));
      if (yes === true) {
        exempt = true;
        log.info(`[gate] exempt: followup src=${source} (session=${sessionCode})`);
      } else if (yes === false) {
        // 판정기가 "아니오" — 정상 다수 경로라 debug (LOG_LEVEL=debug에서만 보임)
        log.debug(`[gate] followup: no (session=${sessionCode})`);
      } else {
        // null = API 실패/타임아웃. 면제 안 하고 쿨다운으로 넘어간다 — 조용히 지나가면 안 됨
        log.warn(`[gate] followup: null — mini-judge 실패, 면제 안 함 (session=${sessionCode})`);
      }
    }
  }

  // [Step 63] 긴 침묵 면제 — 안전망(③)이 쿨다운(②)에 막히는 사각지대를 연다.
  //   조건: 타이머 경로 ∧ 45초 침묵 ∧ Alex 이후 사람 메시지가 1개 이상.
  //   ⚠️ messagesSinceLastAI === 0(= 마지막 발화가 Alex)이면 면제하지 않는다 — 연속 발화 방지는 그대로.
  //   발화하면 그 값이 0이 되어 자동으로 다시 잠기므로 별도 상한이 필요 없다.
  if (
    !exempt &&
    source === "pull" &&
    ctx.messagesSinceLastAI >= 1 &&
    ctx.secondsSinceLastMessage !== null &&
    ctx.secondsSinceLastMessage >= TRIGGER_CONFIG.LONG_SILENCE_SECONDS
  ) {
    exempt = true;
    log.info(`[gate] exempt: long-silence src=${source} (session=${sessionCode})`);
  }

  // ② cooldown — 면제되지 않았을 때만 적용
  if (!exempt && ctx.messagesSinceLastAI < TRIGGER_CONFIG.COOLDOWN_MIN_MSGS) {
    log.debug(
      `[gate] cooldown hold (msgsSinceAI=${ctx.messagesSinceLastAI}, session=${sessionCode})`,
    ); // [Step 55]
    return;
  }

  // ②.3 [Step 45] 수렴 마무리 — 소진(새 trait K턴 0) ∧ 양면 floor면 정리→마무리로 조기 closing (leader 전용).
  // 발동 시 closingDone 래치 → 이후 전 사이클 차단(mediation 억제·물러남 자동).
  if (isLeader && !closingDone.has(sessionCode)) {
    const sess = await Session.findById(sessionId).select("revealStats").lean();
    const rs = (sess as any)?.revealStats;
    const total = countSurfaced(rs); // = 표면화 distinct 총수 (소진 판정)
    if (total > (lastSurfacedCount.get(sessionCode) ?? 0)) {
      lastSurfacedCount.set(sessionCode, total);
      lastGrowthSeq.set(sessionCode, ctx.lastMessageSeq); // 새 trait 관측 → 성장 시점 갱신
    }
    const grewAt = lastGrowthSeq.get(sessionCode) ?? ctx.lastMessageSeq;
    const exhausted = ctx.lastMessageSeq - grewAt >= TRIGGER_CONFIG.EXHAUST_K;

    if (exhausted && floorMet(rs)) {
      closingDone.add(sessionCode); // 래치 = 영구 침묵 (기존 메커니즘 재사용)
      log.info(`[gate] converge wrap-up (exhausted ∧ floor, session=${sessionCode})`);
      const leader = computeTally(rs).leader; // neutral summary라 값 무관 (Cand|null)
      await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx, conditionCode, {
        summary: true,
        summaryLeader: leader,
      }); // Step 44 +/− 보드
      const ctx2 = await buildSessionContext(sessionId, sessionCode); // summary 후 transcript 갱신
      await handleAITurn(io, sessionCode, sessionId, CLOSING_TRIGGER, ctx2, conditionCode, {
        closing: true,
        bypassDoublePost: true,
      }); // Step 44 통합 마무리 — 백투백 (closing은 이미 anti-double-post 면제, 플래그는 의도 명시)
      return;
    }
  }

  // ②.5 [Step 22/37] leader summary 게이트 (leader 전용, judge 우회·결정적)
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
      log.info(`[gate] long-silence safety (session=${sessionCode})`);
      const callout = await maybeCalloutOverlay(sessionCode, sessionId, conditionCode, ctx, reason); // [Step 30]
      await handleAITurn(io, sessionCode, sessionId, SILENCE_TRIGGER, ctx, conditionCode, {
        reason,
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
        ...(callout && { callout }),
      });
    }
    return;
  }

  // ④ push = 개입 judge (조건-블라인드, Step 37: 1회·순수 분류)
  const win = await loadWindow(sessionId);
  let decision = await judgeIntervention(win.labeled, ctx.messagesSinceLastAI);
  if (decision === null) {
    // [Step 55] judge 호출 실패(타임아웃/파싱)는 지금까지 무음이었다 — 매 턴 도는 판정기의 조용한 죽음을 드러낸다.
    log.warn(
      `[judge] null — API 실패 또는 타임아웃, 레거시 트리거로 폴백 (msgsSinceAI=${ctx.messagesSinceLastAI}, session=${sessionCode})`,
    );
    const fired = await evaluateTriggers(ctx);
    log.info(`[judge] fallback ${fired ? `fired=${fired.name}` : "침묵"} (session=${sessionCode})`);
    if (fired) {
      await handleAITurn(io, sessionCode, sessionId, fired, ctx, conditionCode, {
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
      });
    }
    return;
  }
  // [EXP] judge가 침묵을 택하면 status-only 자연발화(directed_followup)로 리라우팅 — 로그 *전*에 적용해 speak 값과 한 줄로 일치.
  let natural = false; // [Step 53] 자연발화로 대체된 턴인가
  let rerouted = false;
  if (!decision.speak && TRIGGER_CONFIG.EXP_NATURAL_DIRECTED) {
    decision = { speak: true, reason: "directed_followup" };
    rerouted = true;
    natural = true; // [Step 53] 판정기가 침묵을 택함 → 자연발화로 때우는 턴
  }
  log.info(
    `[judge] speak=${decision.speak} reason=${decision.reason}${rerouted ? " (EXP reroute ← judge silent)" : ""} (session=${sessionCode})`,
  );

  // 침묵: 평가받고 침묵한 결정 영속 (Step 20). EXP off일 때만 도달 (cooldown이 거리 게이트를 외재화).
  if (!decision.speak) {
    logSilence(sessionId, ctx.lastMessageSeq, "judge", decision.reason, "");
    return;
  }

  // peer(C1/C3)는 mediation(리더 전용 행동)을 하지 않는다 → 강제 침묵 대신 self-scoped 자연발화로 리라우트.
  // judge 침묵→directed_followup reroute(위)와 동일 처리로 비대칭 제거. buildNaturalPrompt는 팀 중재 안 함 → 직교성 안전.
  if (decision.reason === "mediation" && (conditionCode === "C1" || conditionCode === "C3")) {
    log.info(`[judge] peer-mediation → directed_followup reroute (session=${sessionCode})`);
    decision = { speak: true, reason: "directed_followup" };
    natural = true; // [Step 53] peer는 중재 안 함 → 자기 발화로 대체
  }

  // 발화 확정 — leader면 callout 오버레이(형식만, 발화 여부엔 0 관여)
  const callout = await maybeCalloutOverlay(
    sessionCode,
    sessionId,
    conditionCode,
    ctx,
    decision.reason,
  ); // [Step 30]
  await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
    reason: decision.reason,
    recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
    ...(natural && { natural: true }), // [Step 53]
    ...(callout && { callout }),
  });
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
      log.error("[pull] turn error:", e),
    );
  }, TRIGGER_CONFIG.PULL_EVALUATION_INTERVAL_MS);
  sessionIntervals.set(sessionCode, interval);
  log.debug(`[pull-trigger] started for ${sessionCode}`);
}

// [Step 31-⑦] export: completed 전이 시 라우트(routes/sessions.ts)에서 호출 — 유령 long-silence 발화 차단
export function stopPullEvalution(sessionCode: string) {
  const interval = sessionIntervals.get(sessionCode);
  if (interval) {
    clearInterval(interval);
    sessionIntervals.delete(sessionCode);
    log.debug(`[pull-trigger] stopped for ${sessionCode}`);
  }
  // closing/summary/callout 게이트 상태 정리 (메모리 누수 방지)
  sessionStartedAt.delete(sessionCode);
  closingDone.delete(sessionCode);
  openingDone.delete(sessionCode);
  summaryDone.delete(sessionCode); // [Step 37]
  lastSummaryAtSeq.delete(sessionCode);
  lastSummaryLeader.delete(sessionCode);
  lastSurfacedCount.delete(sessionCode); // [Step 45]
  lastGrowthSeq.delete(sessionCode);
  calloutCount.delete(sessionCode); // [Step 30]
  lastCalloutAtSeq.delete(sessionCode);
  lastCalloutTarget.delete(sessionCode);
}

// [Step 32-⑥] 인터벌만 정지 — stopPullEvalution과 달리 게이트 상태 맵(closingDone/openingDone/
// summary*/callout* 등)은 보존. 지우면 재입장 시 closing/opening 재발화 위험.
// G5 hold 동안 빈 방 long-silence 유령 발화 차단. 재개는 join-session의 startPullEvalution 멱등 호출.
function pausePullEvalution(sessionCode: string) {
  const interval = sessionIntervals.get(sessionCode);
  if (interval) {
    clearInterval(interval);
    sessionIntervals.delete(sessionCode);
    log.info(`[pull-trigger] paused for ${sessionCode} (room empty)`);
  }
}

// [killswitch] 연구자 수동 음소거 — closingDone 래치(영구 침묵) + pull 틱 정지(latch 보존). 토론·사람은 계속.
// stopPullEvalution 금지: 그 함수는 closingDone을 삭제해 음소거가 풀림. 인터벌만 멈추는 pausePullEvalution을 씀.
// 재입장으로 pull 틱이 다시 켜져도 closingDone 래치가 남아 maybeAITurn line 316에서 즉시 return → 발화 0.
export function forceMuteAI(sessionCode: string) {
  closingDone.add(sessionCode); // durable: maybeAITurn 진입부에서 return
  pausePullEvalution(sessionCode); // 인터벌만 — closingDone 유지
  log.info(`[killswitch] AI muted by researcher (session=${sessionCode})`);
}

export function registerSocketHandlers(io: IO) {
  io.on("connection", (socket: AppSocket) => {
    log.debug(`[socket] connected: ${socket.id}`);

    socket.on("join-session", async ({ sessionCode, participantCode }) => {
      //log.info(`[socket] join-session received: ${sessionCode}, ${participantCode}`);
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
        // 4. [Step 23] 역할 유효성 + 역할 충돌 + 하드캡
        const requiredRoles = requiredRolesFor(session.conditionCode);
        // (a) 이 세션에 없는 역할이면 거절 (등록 단계 실수 방어)
        if (!requiredRoles.includes(participant.role)) {
          socket.emit("join-error", {
            reason: `Role ${participant.role} is not part of this session.`,
          });
          return;
        }
        // (b) 같은 역할을 '다른 코드'가 이미 점유 = 진짜 슬롯 충돌 → 거절 (코드 잘못 입력 표면화)
        const roleTakenByOther =
          !!room &&
          [...room].some((sid) => {
            const s = io.sockets.sockets.get(sid);
            return s?.data?.role === participant.role && s?.data?.participantCode !== participantCode;
          });
        if (roleTakenByOther) {
          socket.emit("join-error", {
            reason: `Role ${participant.role} is already taken in this session — check your participant code.`,
          });
          return;
        }
        // (c) 하드캡 (runaway 방지) — 재접속(같은 코드)은 예외
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

        log.debug(
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
          startedAt: session.startedAt ? session.startedAt.toISOString() : null, // [Step 26-A]
          aiName: aiDisplayName(session.conditionCode as ConditionCode), // [Step 30] 라벨만 전달 (조건 코드 미노출)
        });
        log.debug(`[socket] sent ${allMessages.length} history messages to ${participant.role}`);

        //8. 재접속 알림
        if (isReconnect) {
          socket.to(sessionCode).emit("peer-reconnected", { role: participant.role });
          log.info(`[session] ${participant.role} rejoined ${sessionCode}`); // [Step 26-C] 연구자용
        }

        // 9. [Step 23] 필요한 역할이 모두 모였을 때만 세션 시작 (소켓 수 아님 · reconnect 타이밍 무관)
        const present = presentRoles(io, sessionCode);
        const allRolesPresent = requiredRoles.every((r) => present.has(r));
        const roomSize = io.sockets.adapter.rooms.get(sessionCode)?.size ?? 0;

        // 중복 코드 표면화: 소켓은 정원 찼는데 역할이 안 채워짐 = 같은 코드 2명 의심
        if (!allRolesPresent && roomSize >= maxParticipants) {
          log.warn(
            `[socket] ⚠️ ${sessionCode}: ${roomSize} sockets but roles=[${[...present]}] ` +
              `(missing ${requiredRoles.filter((r) => !present.has(r)).join(",")}) — likely duplicate participant code, NOT starting`,
          );
        }

        if (allRolesPresent) {
          // [Step 24] 원자적 전이: 동시 호출 중 딱 하나만 waiting→in_progress 성공 (won 비-null)
          const won = await Session.findOneAndUpdate(
            { _id: session._id, status: "waiting" },
            { $set: { status: "in_progress", startedAt: new Date() } },
            { returnDocument: "after" },
          );
          const startedAt = won?.startedAt ?? session.startedAt;
          if (won) {
            log.info(
              `[socket] session ${sessionCode} status: waiting -> in_progress (roles complete)`,
            );
          }
          // closing 게이트용 시작 시각 보관 (Step 4/B)
          if (startedAt) {
            sessionStartedAt.set(sessionCode, startedAt.getTime());
          }
          if (won) {
            io.to(sessionCode).emit("session-ready", { sessionCode, participantCount: roomSize });
          }
          if (session.conditionCode !== "CTRL") {
            // startPullEvalution은 sessionIntervals 가드, insertOpening은 openingDone 가드로 멱등
            startPullEvalution(
              io,
              sessionCode,
              session._id.toString(),
              session.conditionCode as ConditionCode,
            );
            await insertOpening(
              io,
              sessionCode,
              session._id.toString(),
              session.conditionCode as ConditionCode,
            );
          }
        }
      } catch (error) {
        log.error("[socket] join-session error:", error);
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

        // [Step 25] 이미 시작된 세션이면 대기 불필요 → 곧장 채팅으로 (상대는 이미 채팅 방에 있음)
        if (session.status === "in_progress") {
          socket.emit("both-ready", { sessionCode });
          log.debug(`[socket] join-waiting: ${sessionCode} already in_progress → bounce to chat`);
          return;
        }

        //3. waiting room 입장 (ChatRoom과 분리하기 위해 prefix사용)
        const waitingRoom = `waiting:${sessionCode}`;
        socket.data.role = participant.role; // [Step 23] 대기실에서도 역할 기준 ready 판정에 필요
        await socket.join(waitingRoom);

        //4. lastSeenAt 갱신
        await Participant.updateOne({ _id: participant._id }, { $set: { lastSeenAt: new Date() } });

        //5. [Step 23] 현재 대기실 distinct 역할 확인 (소켓 수 아님)
        const room = io.sockets.adapter.rooms.get(waitingRoom);
        const present = presentRoles(io, waitingRoom);
        const requiredRoles = requiredRolesFor(session.conditionCode);
        const ready = requiredRoles.every((r) => present.has(r));

        log.debug(
          `[socket] join-waiting: ${sessionCode}, ${participantCode}, ${present.size}/${requiredRoles.length}`,
        );

        //6. 모두에게 현재 인원 broadcast
        io.to(waitingRoom).emit("waiting-update", {
          participantsReady: present.size,
          expected: requiredRoles.length,
        });

        //7. 역할 모두 모이면 both-ready emit
        if (ready) {
          io.to(waitingRoom).emit("both-ready", { sessionCode });
          log.info(`[socket] both-ready (roles complete): ${sessionCode}`);
        } else if (room && room.size >= requiredRoles.length) {
          log.warn(
            `[socket] ⚠️ waiting ${sessionCode}: ${room.size} sockets, roles=[${[...present]}] — duplicate code?`,
          );
        }
      } catch (error) {
        log.error("[socket] join-waiting error:", error);
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
        log.info(`[socket] message saved: ${sessionCode} seq=${nextSeq} role=${role}`);

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
            .then(async (ids) => {
              const n = await updateRevealStats(sessionId, ids, nextSeq); // [Step 62] seq
              if (ids.length)
                log.info(
                  `[pooling] surfaced ${JSON.stringify(ids)} by=${role} seq=${nextSeq} new=${n} (session=${sessionCode})`,
                );
            })
            .catch((e) => log.error("[pooling] extract error:", e));
        }

        //6. Push 트리거 평가 - AI 호출은 비동기 (핸들러 안 막음)
        if (conditionCode !== "CTRL") {
          maybeAITurn(io, sessionCode, sessionId, conditionCode as ConditionCode, "push").catch(
            (e) => log.error("[push] turn error:", e),
          );
        }
      } catch (error) {
        log.error(`[socket] send-message error:`, error);
        socket.emit("message-failed", { reason: "Server error while saving message" });
      }
    });
    // 입력 중(작성중) 표시 — DB 저장 없이 같은 방의 상대에게만 릴레이 (본인 제외).
    socket.on("typing", ({ isTyping }) => {
      const { sessionCode, role } = socket.data;
      if (!sessionCode || !role) return;
      socket.to(sessionCode).emit("peer-typing", { role, isTyping });
    });

    socket.on("disconnect", async (reason) => {
      log.debug(`[socket] disconnected: ${socket.id} (${reason})`);
      //socket.data에 정보 있으면 peer 에게 알림
      const { sessionCode, role, participantCode, sessionId } = socket.data;
      if (sessionCode && role) {
        //peer에게 알림
        socket.to(sessionCode).emit("peer-disconnected", { role });
        log.info(`[session] ${role} left ${sessionCode}`); // [Step 26-C] 연구자용 (소켓ID 줄은 debug)

        // [Step 32-⑥] 방이 완전히 비면 pull 인터벌 일시정지 (disconnect 시점엔 이 소켓은 이미 방에서 빠짐)
        // 대기실 소켓은 socket.data.sessionCode 미설정이라 이 분기 안 탐 — 오발동 없음
        if (presentRoles(io, sessionCode).size === 0) pausePullEvalution(sessionCode);

        //마지막 활동 시간
        if (participantCode && sessionId) {
          try {
            await Participant.findOneAndUpdate(
              { sessionId, participantCode },
              { lastSeenAt: new Date() },
            );
          } catch (error) {
            log.error(`[socker] failed to update lastSeenAt:`, error);
          }
        }
      }
    });
  });
}
