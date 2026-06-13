import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events.js";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { buildSessionContext, evaluateTriggers } from "../triggers/evaluate.js";
import { handleAITurn } from "../lib/aiTurn.js";
import { LEADER_OPENING } from "../lib/prompts.js";
import { getSessionLang, KO_LEADER_OPENING } from "../lib/koPilot.js"; // [KO-PILOT]
import { judgeIntervention, JUDGE_WINDOW_SIZE } from "../lib/interventionJudge.js";
import { computeCue, ADDRESS_RE } from "../lib/computeCue.js";
import { extractSurfacedTraits } from "../lib/poolingExtractor.js";
import {
  updateRevealStats,
  computeTally,
  countSurfaced,
  leastCoveredCandidate,
  nextUnsurfacedZ, // [Step 36]
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
const ADDRESS_TRIGGER: Trigger = { name: "address", shouldFire: () => false };
const JUDGE_TRIGGER: Trigger = { name: "judge", shouldFire: () => false };
const SILENCE_TRIGGER: Trigger = { name: "long-silence", shouldFire: () => false };
// ── Step 28/B: mediation 자기모순 재판정 가드 ──────────────────────
const REJUDGE_MIN_DIST = 4; // Alex 발화 후 이만큼 지났는데 '교착 진단+침묵'이면 재판정
// ── [Step 31-①] leader mediation 간격 가드 (R1 연발: 같은 재확장 변주 ~4할 → 결정적 차단) ──
const LEADER_MEDIATION_MIN_GAP_MSGS = 4; // mediation 발화 간 최소 메시지 수 (사람+AI seq 기준)
const lastMediationAtSeq = new Map<string, number>(); // leader mediation-내용 발화 시점
// ── Step 16/Part B: peer mediation 침묵 하한선 ─────────────────────
const PEER_MEDIATION_FLOOR_K = 3; // [Step 31-③] 5→3 — peer 침묵 6msg 구간(C1·C3 2/2) 단축. 도달 시 react로 치환.
const peerMediationStreak = new Map<string, number>(); // sessionCode → 연속 peer-mediation 억제 횟수
const PEER_FLOOR_TRIGGER: Trigger = { name: "peer-mediation-floor", shouldFire: () => false };
// ── [Step 35] open-room silence floor — Step 34 leader mediation floor 일반화 ──
const LEADER_OPENROOM_FLOOR_K = 3; // 연속 거른 '활발한 방' 침묵 3번째마다 react 1회 (Step 34 K 유지)
const OPEN_ROOM_SILENCE_REASONS = new Set<string>(["build_on", "mediation", "open_floor"]); // Alex 관여 기대 구간 (directed_followup=항상발화/social=잡담/react=fill 제외)
const leaderOpenRoomSilenceStreak = new Map<string, number>(); // sessionCode → 연속 leader speak=false open-room 침묵 횟수
const LEADER_FLOOR_TRIGGER: Trigger = { name: "leader-mediation-floor", shouldFire: () => false }; // 이름 유지 (트리거 라벨)
// [Step 34] 실제 발화 시 mediation 침묵 카운터 동시 리셋 (peer/leader 같은 철학 — 두 줄이 항상 같이 다님)
function resetMediationStreaks(sessionCode: string) {
  peerMediationStreak.set(sessionCode, 0);
  leaderOpenRoomSilenceStreak.set(sessionCode, 0); // [Step 35] was leaderMediationFalseStreak
}
// ── [Step 36] 종료 국면 (소진 감지 → 프로브 → Z-drip → min-게이트 close) ──
const EXHAUSTION_NOYIELD_K = 3; // 신규 추출 0인 사람 메시지 연속 (AI 제외) → 소진 판정
const EXHAUSTION_RE =
  /없\s*(어|어요|네|습니다)|이게\s*다|더\s*(이상\s*)?(없|모르)|모르겠|that'?s\s+(all|it)|nothing\s+(else|more)|i'?m\s+(out|done)/i;
const exhaustionPhase = new Map<string, "active" | "probed" | "draining" | "closed">();
const noYieldStreak = new Map<string, number>(); // sessionCode → 연속 무수확 사람 메시지 수
const ZDRIP_TRIGGER: Trigger = { name: "zdrip", shouldFire: () => false };
const EXH_PROBE_TRIGGER: Trigger = { name: "exhaustion-probe", shouldFire: () => false };
const EXH_CLOSE_TRIGGER: Trigger = { name: "exhaustion-close", shouldFire: () => false };
// ── Step 22: leader summary (중간정리) 게이트 상태 ─────────────────
const summaryPrevLeader = new Map<string, Cand | null>(); // 직전 체크 시 1등 (전이 감지)
const summaryArmedLeader = new Map<string, Cand>(); // 안정성 대기 중인 새 1등 (가드②)
const lastSummaryAtSeq = new Map<string, number>(); // 마지막 summary 시점 seq (가드③ 쿨다운)
const lastSummaryLeader = new Map<string, Cand>(); // 마지막 summary가 선언한 1등 (wobble 컨텍스트·재정리 방지)
const SUMMARY_TRIGGER: Trigger = { name: "summary", shouldFire: () => false };
const SUMMARY_MIN_SURFACED = 8; // ① 표면화된 distinct trait 최소 (총 40 중) — 초반 성급 차단
const SUMMARY_COOLDOWN_MSGS = 8; // ③ 마지막 summary 후 최소 사람+AI 메시지 수 (≈4~5턴)
// ② 안정성 = "한 박자" = 전이 후 다음 체크에도 같은 1등이면 발동 (armedLeader 메커니즘)

// ── [Step 30] leader 지목 호명 overlay (방향 A — 기존 발화에 형식만) ──
const CALLOUT_MAX_PER_SESSION = 2; // G1 세션 상한
const CALLOUT_COOLDOWN_MSGS = 8; // G2 지목 간 최소 메시지 (summary와 동일 스케일)
const CALLOUT_SUMMARY_SPACING_MSGS = 4; // G4 summary와 최소 간격 (lastSummaryAtSeq 읽기 전용)
const CALLOUT_CLOSING_MARGIN_MS = 180_000; // G5 마지막 3분 지목 금지
const CALLOUT_MIN_SURFACED = 4; // G6 초반 금지 (깔린 정보)
const CALLOUT_MIN_MSGS = 6; //    초반 금지 (총 메시지)
const calloutCount = new Map<string, number>();
const lastCalloutAtSeq = new Map<string, number>();
const lastCalloutTarget = new Map<string, ParticipantRole>(); // G3 무응답 잠금용

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
  openingDone.add(sessionCode); // [Step 27-A] await 前 동기 클레임 — 동시 진입 봉쇄 (Node 단일스레드: has↔add 사이 양보 없음)
  // [Step 26-B] 영속 가드(목적 유지): 서버 재시작 후 in_progress 재접속 시 재삽입 방지
  if (await Message.exists({ sessionId })) return;

  try {
    const lang = await getSessionLang(sessionId); // [KO-PILOT]
    const opening = lang === "ko" ? KO_LEADER_OPENING : LEADER_OPENING; // [KO-PILOT]
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
    log.info(`[opening] leader opening inserted for ${sessionCode}`);
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

  // [Step 27-B] summaryPrevLeader = "마지막으로 확정(=정리)한 1등". 매 체크 갱신 금지 — 발동 시에만.
  // (구버전은 매 체크 덮어써서 '전이'가 1체크짜리 사건이 됨 → 가드②가 연속 2회 전이를 요구 = 구조적 발동 불가)
  const confirmed = summaryPrevLeader.get(sessionCode) ?? null;

  // 전이 아님: 1등 없음(동률) 또는 이미 정리한 1등 그대로 → 무장 해제
  if (cur === null || cur === confirmed) {
    summaryArmedLeader.delete(sessionCode);
    return false;
  }

  // 가드② 안정성("한 박자"): 새 1등 1번째 목격 → 무장만 (다른 새 1등으로 바뀌면 재무장)
  if (summaryArmedLeader.get(sessionCode) !== cur) {
    summaryArmedLeader.set(sessionCode, cur);
    return false;
  }

  // ── 같은 새 1등 연속 2회+ 목격 (전이 확인됨) ──
  // 가드①③·A-4 미충족 시 "무장 유지한 채 보류" → 충족되는 첫 체크에서 발동 (cur가 유지되는 한)
  if (countSurfaced(rs) < SUMMARY_MIN_SURFACED) return false;
  const lastAt = lastSummaryAtSeq.get(sessionCode) ?? -Infinity;
  if (ctx.lastMessageSeq - lastAt < SUMMARY_COOLDOWN_MSGS) return false;
  if (await hasUnansweredAddress(sessionId)) {
    log.info(`[gate] summary deferred → unanswered address (session=${sessionCode})`);
    return false;
  }

  // 발동 — confirmed(summaryPrevLeader) 갱신은 오직 여기
  summaryArmedLeader.delete(sessionCode);
  summaryPrevLeader.set(sessionCode, cur);
  lastSummaryAtSeq.set(sessionCode, ctx.lastMessageSeq);
  lastSummaryLeader.set(sessionCode, cur);
  const transition = confirmed === null ? "T4(tie→solo)" : `T2(${confirmed}→${cur})`;
  log.info(`[gate] leader summary (leader=${cur}, ${transition}, session=${sessionCode})`);
  await handleAITurn(io, sessionCode, sessionId, SUMMARY_TRIGGER, ctx, conditionCode, {
    summary: true,
    summaryLeader: cur,
    summaryTransition: transition,
  });
  return true;
}

// ── [Step 30] 지목 호명 overlay 게이트 ──────────────────────────────
type CalloutOpts = { target: string; targetRole: ParticipantRole; cand?: Cand };

// [Step 36] callout 대상(WHOM)+cand 선정 — maybeCalloutOverlay와 exhaustion probe가 공유.
// 순수 선정만 (G가드·상태변이는 호출부 책임 — probe는 G1~G6 우회). rs는 호출부가 이미 로드해 전달.
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
    // 트리거 매칭 (G7 leader-only 함의) — directed_followup·open_floor 등은 여기서 걸러짐
    // [Step 31-④] C2: build_on(희박 — 리더 발화 패턴상 중반 슬롯 없음, 2런 실증) ∪ mediation(C4에서 검증된 서식지)
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

    // G4 summary 간격 (읽기 전용 — summary 상태 변이 금지)
    const sumAt = lastSummaryAtSeq.get(sessionCode);
    if (sumAt !== undefined && ctx.lastMessageSeq - sumAt < CALLOUT_SUMMARY_SPACING_MSGS)
      return null;

    // G5 종반 마진
    const startedMs = sessionStartedAt.get(sessionCode);
    if (
      startedMs !== undefined &&
      startedMs + TRIGGER_CONFIG.DISCUSSION_DURATION_MS - Date.now() < CALLOUT_CLOSING_MARGIN_MS
    )
      return null;

    // G6 초반 금지
    if (ctx.totalMessageCount < CALLOUT_MIN_MSGS) return null;
    const sess = await Session.findById(sessionId).select("revealStats").lean();
    const rs = (sess as any)?.revealStats;
    if (countSurfaced(rs) < CALLOUT_MIN_SURFACED) return null;

    // WHOM/cand 선정 — [Step 36] 공유 헬퍼 (probe와 동일 로직). G6 통과로 사람 메시지 존재 보장.
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
        resetMediationStreaks(sessionCode); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
        await handleAITurn(io, sessionCode, sessionId, CLOSING_TRIGGER, ctx, conditionCode, {
          closing: true,
        });
        log.info(`[closing] fired for ${sessionCode}`);
      }
      return;
    }
  }

  const ctx = await buildSessionContext(sessionId, sessionCode);

  // ① 호명 fast-path (push·pull 공통, judge보다 우선·결정적)
  if (!ctx.lastMessageIsAI && ADDRESS_RE.test(ctx.lastMessageText)) {
    log.info(`[gate] address (session=${sessionCode})`);
    resetMediationStreaks(sessionCode); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
    pushReason(sessionCode, "directed_followup"); // Step 21
    await handleAITurn(io, sessionCode, sessionId, ADDRESS_TRIGGER, ctx, conditionCode, {
      reason: "directed_followup",
      recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
    });
    return;
  }

  // ② pre-filter: AI 발화 후 새 사람 메시지 없으면 아무것도 안 함
  if (ctx.messagesSinceLastAI < 1) return;

  // ②.4 [Step 36] 종료 국면 — leader+peer. summary/judge/floor/45s 안전망 선점.
  {
    const phase = exhaustionPhase.get(sessionCode) ?? "active";
    if (phase !== "closed") {
      const streak = noYieldStreak.get(sessionCode) ?? 0;
      const exhausted = streak >= EXHAUSTION_NOYIELD_K || EXHAUSTION_RE.test(ctx.lastMessageText);
      const startedMs2 = sessionStartedAt.get(sessionCode);
      const elapsed = startedMs2 !== undefined ? Date.now() - startedMs2 : 0;
      if (exhausted) {
        const sess = await Session.findById(sessionId).select("revealStats").lean();
        const rs = (sess as any)?.revealStats;
        if (elapsed >= TRIGGER_CONFIG.MIN_DISCUSSION_MS) {
          // ⑤ CLOSE (최우선; phase=closed, closingDone — 이후 영구 침묵)
          exhaustionPhase.set(sessionCode, "closed");
          closingDone.add(sessionCode);
          resetMediationStreaks(sessionCode);
          const tallyLeader = computeTally(rs).leader; // Cand | null (confident-solo 픽 정책)
          log.info(`[gate] exhaustion close (leader=${tallyLeader ?? "none"}, session=${sessionCode})`);
          await handleAITurn(io, sessionCode, sessionId, EXH_CLOSE_TRIGGER, ctx, conditionCode, {
            closing: true,
            exhaustionClose: true,
            closeLeader: tallyLeader,
          });
          return;
        }
        if (isLeader && phase === "active") {
          // ② PROBE (leader만 — 절차 pull은 status로 정당화). callout 머신 재사용, G가드 우회.
          exhaustionPhase.set(sessionCode, "probed");
          noYieldStreak.set(sessionCode, 0);
          const probe = await pickCalloutTarget(sessionId, conditionCode, rs);
          resetMediationStreaks(sessionCode);
          pushReason(sessionCode, "mediation");
          log.info(`[gate] exhaustion probe (target=${probe.target}${probe.cand ? `, cand=${probe.cand}` : ""}, session=${sessionCode})`);
          await handleAITurn(io, sessionCode, sessionId, EXH_PROBE_TRIGGER, ctx, conditionCode, {
            reason: "mediation",
            callout: probe,
          });
          return;
        }
        const z = nextUnsurfacedZ(rs);
        if (z) {
          // ④ Z-DRIP (leader+peer) — 안 깐 Z 1개를 조건 말투로 기여
          exhaustionPhase.set(sessionCode, "draining");
          noYieldStreak.set(sessionCode, 0);
          resetMediationStreaks(sessionCode);
          pushReason(sessionCode, "open_floor");
          log.info(`[gate] exhaustion z-drip (id=${z.id}, cand=${z.cand}, session=${sessionCode})`);
          await handleAITurn(io, sessionCode, sessionId, ZDRIP_TRIGGER, ctx, conditionCode, {
            zdrip: z,
          });
          return;
        }
        // else: Z 소진 + pre-MIN → 조용 (open-room floor가 dead-air 받침, MIN까지 대기)
      }
    }
  }

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
      log.info(`[gate] long-silence safety (session=${sessionCode})`);
      resetMediationStreaks(sessionCode); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
      pushReason(sessionCode, reason); // Step 21
      const callout = await maybeCalloutOverlay(sessionCode, sessionId, conditionCode, ctx, reason); // [Step 30]
      // [Step 31-①] 안전망 mediation 발화도 간격 기준점으로 포함 (발화 자체는 억제 안 함 — 45초 정적은 별개)
      if (reason === "mediation" && isLeader) {
        lastMediationAtSeq.set(sessionCode, ctx.lastMessageSeq);
      }
      await handleAITurn(io, sessionCode, sessionId, SILENCE_TRIGGER, ctx, conditionCode, {
        reason,
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
        ...(callout && { callout }),
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
      resetMediationStreaks(sessionCode); // 실제 발화 → 연속 억제 끊김 (Step 16/B-3)
      await handleAITurn(io, sessionCode, sessionId, fired, ctx, conditionCode, {
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
      });
    }
    return;
  }
  log.info(
    `[judge] speak=${decision.speak} reason=${decision.reason} why="${decision.why}" (session=${sessionCode})`,
  );
  // [Step 28-B] 재판정 가드: '교착 진단(mediation)인데 침묵 + Alex가 멀리' 패턴만 judge 1회 재호출.
  // 강제 플립이 아니라 재시험 — 두 번 중 한 번이라도 speak=true면 발화 (mini 자기모순 플립 노이즈 흡수).
  let final = decision;
  if (
    !decision.speak &&
    decision.reason === "mediation" &&
    ctx.messagesSinceLastAI >= REJUDGE_MIN_DIST
  ) {
    const retry = await judgeIntervention(
      win.labeled,
      ctx.messagesSinceLastAI,
      recentReasons.get(sessionCode) ?? [],
    );
    log.info(
      `[judge] re-judge (false∧mediation∧dist≥${REJUDGE_MIN_DIST}) → speak=${retry?.speak ?? "null"} (session=${sessionCode})`,
    );
    if (retry?.speak) final = retry;
  }

  if (final.speak) {
    // [Step 31-①] leader mediation 간격 가드 — 직전 mediation 발화에서 4msg 미만이면 억제 (재확장 연발 차단).
    // callout(④)보다 앞: 턴 자체가 억제되면 지목 시도도 없음 (지목 카운트 미소모). pushReason도 미호출 (이력 오염 0).
    if (final.reason === "mediation" && isLeader) {
      const lastMed = lastMediationAtSeq.get(sessionCode);
      if (lastMed !== undefined && ctx.lastMessageSeq - lastMed < LEADER_MEDIATION_MIN_GAP_MSGS) {
        log.info(
          `[gate] leader mediation gap hold (dist=${ctx.lastMessageSeq - lastMed}/${LEADER_MEDIATION_MIN_GAP_MSGS}, session=${sessionCode})`,
        );
        logSilence(sessionId, ctx.lastMessageSeq, "leader-mediation-gap", "mediation", final.why); // S20 — 분석용
        return;
      }
    }
    // peer(C1/C3)는 mediation(리더 전용 행동)을 하지 않는다 → 기본은 침묵.
    // 단, 연속 억제가 K회에 달하면 영영 묵게 두지 않고 그 1회를 react(가벼운 맞장구)로 풀어준다 — Step 16/고려사항2 · Step 31-③
    if (final.reason === "mediation" && (conditionCode === "C1" || conditionCode === "C3")) {
      const streak = (peerMediationStreak.get(sessionCode) ?? 0) + 1;
      if (streak < PEER_MEDIATION_FLOOR_K) {
        peerMediationStreak.set(sessionCode, streak);
        log.info(
          `[gate] peer mediation suppressed → silent (streak=${streak}/${PEER_MEDIATION_FLOOR_K}, session=${sessionCode})`,
        );
        logSilence(sessionId, ctx.lastMessageSeq, "peer-mediation-suppressed", "mediation", final.why); // Step 20 — 조건 효과 분석용
        return;
      }
      // [Step 31-③] 하한선 도달: mediation 대신 react(가벼운 맞장구) 1회 + 카운터 리셋.
      // react는 judge anti-repeat 면제 reason — 연쇄 부작용 없음. peer는 react 기본문만(leader 추가문은 isLeader 분기).
      // 분석 단절점: K=5/open_floor 세션(~T-C3-005까지)과 K=3/react 세션의 peer 발화 분포는 비교 불가 — 본실험은 전부 Step 31+ 기준.
      resetMediationStreaks(sessionCode);
      log.info(
        `[gate] peer mediation floor reached (streak=${streak}) → remap to react (session=${sessionCode})`,
      );
      pushReason(sessionCode, "react"); // Step 21
      await handleAITurn(io, sessionCode, sessionId, PEER_FLOOR_TRIGGER, ctx, conditionCode, {
        react: true,
      });
      return;
    }
    resetMediationStreaks(sessionCode); // mediation 억제 통과 = 실제 발화 확정 → 연속 억제 끊김 (Step 16/B-3)
    pushReason(sessionCode, final.reason); // Step 21 — judge 발화 전부 (social/react/task 공통)
    if (final.reason === "social") {
      // social: 전용 SOCIAL_PROMPT로 분기 (task cue 미주입, 조건 무관 통제). transcript로 맥락 반영.
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        social: true,
      });
    } else if (final.reason === "react") {
      // react: 전용 buildReactPrompt로 분기 (Step 13) — 가벼운 ack, task cue 미주입.
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        react: true,
      });
    } else {
      const callout = await maybeCalloutOverlay(
        sessionCode,
        sessionId,
        conditionCode,
        ctx,
        final.reason,
      ); // [Step 30] — 발화 확정 후 형식만 결정 (발화 여부에 0 관여)
      // [Step 31-①] mediation 발화 기준점 갱신 (간격 가드용)
      if (final.reason === "mediation" && isLeader) {
        lastMediationAtSeq.set(sessionCode, ctx.lastMessageSeq);
      }
      await handleAITurn(io, sessionCode, sessionId, JUDGE_TRIGGER, ctx, conditionCode, {
        reason: final.reason,
        recentSummaryLeader: lastSummaryLeader.get(sessionCode), // Step 22/C-2
        ...(callout && { callout }),
      });
    }
  } else {
    // [Step 35] open-room silence floor — speak=false인데 '활발한 방' reason이면 한 카운터로 세고 K번째마다 react.
    // 진짜 발화(speak=true)·gap 가드·summary·callout·peer 경로 전부 무변경. 여기는 '거른 것'만 가볍게 줍는다.
    if (isLeader && OPEN_ROOM_SILENCE_REASONS.has(final.reason)) {
      const streak = (leaderOpenRoomSilenceStreak.get(sessionCode) ?? 0) + 1;
      if (streak < LEADER_OPENROOM_FLOOR_K) {
        leaderOpenRoomSilenceStreak.set(sessionCode, streak);
        log.info(
          `[gate] leader open-room floor suppressed → silent (reason=${final.reason}, streak=${streak}/${LEADER_OPENROOM_FLOOR_K}, session=${sessionCode})`,
        );
        logSilence(sessionId, ctx.lastMessageSeq, "leader-openroom-floor-suppressed", final.reason, final.why); // [Step 35] 실제 reason 보존 (분석)
        return;
      }
      // 하한 도달 → react 1회 + 리셋. callout 미시도(react는 지목 대상 아님). buildReactPrompt(무접촉) 그대로.
      leaderOpenRoomSilenceStreak.set(sessionCode, 0);
      log.info(`[gate] leader open-room floor reached (reason=${final.reason}, streak=${streak}) → remap to react (session=${sessionCode})`);
      pushReason(sessionCode, "react");
      await handleAITurn(io, sessionCode, sessionId, LEADER_FLOOR_TRIGGER, ctx, conditionCode, { react: true });
      return;
    }
    // Step 20: 평가받고 침묵한 결정 영속 (open-room 아닌 reason = social 등은 여기로)
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
  // closing 게이트 상태 정리 (메모리 누수 방지)
  sessionStartedAt.delete(sessionCode);
  closingDone.delete(sessionCode);
  openingDone.delete(sessionCode);
  peerMediationStreak.delete(sessionCode);
  leaderOpenRoomSilenceStreak.delete(sessionCode); // [Step 35] was leaderMediationFalseStreak
  recentReasons.delete(sessionCode);
  summaryPrevLeader.delete(sessionCode);
  summaryArmedLeader.delete(sessionCode);
  lastSummaryAtSeq.delete(sessionCode);
  lastSummaryLeader.delete(sessionCode);
  calloutCount.delete(sessionCode); // [Step 30]
  lastCalloutAtSeq.delete(sessionCode);
  lastCalloutTarget.delete(sessionCode);
  lastMediationAtSeq.delete(sessionCode); // [Step 31-①]
  exhaustionPhase.delete(sessionCode); // [Step 36]
  noYieldStreak.delete(sessionCode); // [Step 36]
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
            // startPullEvalution은 sessionIntervals 가드, insertLeaderOpening은 openingDone 가드로 멱등
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
            .then((ids) => {
              if (ids.length) log.info(`[pooling] surfaced ${JSON.stringify(ids)} (session=${sessionCode})`);
              return updateRevealStats(sessionId, ids); // [Step 36] 새로 추가된 distinct 수 반환
            })
            .then((addedNew) => {
              // [Step 36] no-yield 추적 (lag: fire-and-forget이라 다음 사이클 반영 — 최대 1메시지)
              if (addedNew > 0) {
                noYieldStreak.set(sessionCode, 0);
                const ph = exhaustionPhase.get(sessionCode);
                if (ph === "probed" || ph === "draining") exhaustionPhase.set(sessionCode, "active"); // 끌어내기 성공 → 재무장
              } else {
                noYieldStreak.set(sessionCode, (noYieldStreak.get(sessionCode) ?? 0) + 1);
              }
            })
            .catch((e) => log.error("[pooling] extract error:", e));
        } else if (conditionCode !== "CTRL") {
          // [Step 36] <15자 잡담 = 무수확 취급 → no-yield streak 증가 (동기)
          noYieldStreak.set(sessionCode, (noYieldStreak.get(sessionCode) ?? 0) + 1);
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
