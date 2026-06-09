# Report 2 — API 발화 품질 개선 플랜: "사람 같은" Alex 만들기

작성: 2026-06-08 · 대상: HAIT API 시스템 (server/ + prompt-management-system/)
문제 정의: 현재 AI(Alex)가 발화를 너무 길게 만들어 대화가 성립하지 않는다. 목표는 **간결·자연·턴테이킹이 사람 같은** AI 발화.
전제: 플랫폼은 API 유지(Report 1 참고). 비용 제약상 라이브로 다 시도할 수 없으므로 **오프라인 eval로 싸게 반복**하는 게 핵심 전략.

---

## 0. 이 플랜이 서는 두 개의 사실

이 플랜은 추측이 아니라 **네 코드와 오늘(2026-06-08) golden 베이스라인 실측**에 근거한다.

1. **발화 과다의 원인은 이미 코드에서 특정됐다.** 가장 큰 단일 원인은 *모델이 나쁜 것*이 아니라, (a) 이미 작성됐지만 런타임에 배선 안 된 "발화-이유(Speaking-Reason) 라우팅", (b) 출력 길이 하드캡 부재, (c) 동결 프롬프트 내부의 *간결성↔철저함* 모순이다.
2. **싸게 검증할 인프라가 이미 있다.** `server/src/eval/run-golden.ts`가 11개 시나리오 × 4조건 = 36런을 `temperature:0`로 돌려 md/json 리포트를 뽑는다. 라이브 피험자 0명, 비용은 센트 단위. 여기에 **자동 채점기만 붙이면** "근거 있는 품질 향상 루프"가 완성된다(§5).

---

## 1. 목표를 측정 가능하게 (조작적 정의)

"사람 같은 발화"를 측정 가능한 5개 속성으로 분해한다. 이게 곧 eval 채점 항목이 된다(§5).

| 속성            | 나쁜 예(현재)                     | 좋은 예(목표)                                | 측정 방법                        |
| ------------- | ---------------------------- | --------------------------------------- | ---------------------------- |
| **간결성**       | 한 턴에 3~4문장, 한 문장에 특질 4개 나열   | 1~2문장, 한 포인트                            | 문자수·문장수 분포                   |
| **추천 강요 안 함** | 매 턴 "My recommendation is D" | 닫는 턴/직접 질문 때만 선호 표명                     | open_floor 턴의 pick 발생률       |
| **발화-이유 적합**  | 모든 턴이 똑같이 "요약+추천"            | opening/build/mediation/closing별로 다른 행동 | 이유별 행동 규칙 위반율                |
| **정보 페이싱**    | Z 지식을 한 턴에 소진                | 여러 턴에 나눠 기여                             | 한 턴당 신규 특질 노출 수              |
| **페르소나 일관**   | (이미 양호)                      | Peer=수평·질문형 / Leader=구조화                | 기존 lint(forbidden vocab) 재사용 |

> 주의: XAI 조건은 "설명 중심"이라 ACI보다 *살짝* 길어도 정상이다. 따라서 길이 게이트는 **조건별로 다르게** 둔다(§5.4). 무지성으로 다 짧게 깎으면 XAI manipulation check("detailed explanations")가 깨진다.

---

## 2. 진단 — 왜 지금 길어지는가 (근거 포함)

### 원인 1 — 동결 프롬프트의 자기모순 (간결성 vs 철저함)

`compiled-prompts.json`의 각 조건 프롬프트 안 "System Constraints" 블록에 다음 문구가 그대로 있다(원 재현 연구 Zercher et al. 유래):

```
You must always calculate the new ratio of positive to negative traits for each candidate.
...
Always give a preference for exactly one candidate.
Always mention all positive and all negative traits of the candidates when asked about their traits.
```

그리고 컴파일 순서상 **맨 마지막**에 `[CRITICAL SYSTEM RULE]`이 렌더된다(`compile_prompt.ts`가 recency 위해 의도적으로 마지막에 둠):

```
[CRITICAL SYSTEM RULE]
The best candidate has the highest ratio... You recommend this candidate. ...
[/CRITICAL SYSTEM RULE]
```

→ 프롬프트의 **마지막 문장이 "You recommend this candidate"**라서 recency 가중으로 **매 턴 추천을 강요**한다. "always mention all ... traits"는 **특질 나열(긴 발화)**을 부른다. 런타임에서 뒤에 붙는 `OUTPUT_DISCIPLINE`("at most 3 short sentences, one focused point")과 **정면 충돌**한다.

**실측 증거 (오늘 baseline, A1 케이스 / open-floor 성격 / leader_xai):**

```
"That point is accurate, and B does bring crisis composure and reliability.
 I want to bring us back to the broader comparison: Candidate D is stronger overall
 because D also reacts adequately to unforeseen events, concentrates very well,
 is very resilient, and is very responsible, which gives D a better balance than B...
 My recommendation is Candidate D."
```

한 문장에 D의 특질 4개를 나열 + 비교 + **요청도 안 했는데 추천 강요**. 바로 옆 fixture의 `hint`(목표 예시)는 *"I can add to B as well — my notes have B as arrogant, with a harsh tone at times. Worth weighing that against the good points as we go through them."* — 짧고 한 포인트. **이 간극이 곧 문제다.**

### 원인 2 — Speaking-Reason 라우팅이 작동하지 않음 ★ (가장 큰 레버)

프롬프트에는 이미 정교한 분기가 **작성돼 있다**(C3 프롬프트 "Speaking-Reason Routing"):

```
By speaking reason:
- opening: frame the task ... Do NOT pick a candidate.
- open_floor / build_on: add ONE focused point ... do not re-survey all candidates and do not force a pick.
- directed_followup: answer what was actually asked ...
- mediation: ... Take NO side and give NO pick.
- closing: ... commit to exactly one candidate.
If no speaking reason is given, treat it as open_floor: add one relevant point and do not force a pick...
```

프롬프트 저자는 원인 1의 추천-강요 문제까지 미리 알고 방어 문구도 넣었다: *"Giving a preference ... is NOT an instruction to announce a pick on every turn. State a preference only when the turn calls for it."*

**그런데 이 방어 로직은 절대 발동하지 않는다.** 런타임이 speaking reason을 **주입하지 않기** 때문이다:

- `aiTurn.ts → handleAITurn`은 `trigger`(이름: `message-count`/`time-interval`/`long-silence`)를 받지만, 그걸 프롬프트의 speaking reason 토큰(opening/build_on/...)으로 **변환하지 않는다.**
- `prompts.ts → buildUserPromptFromMessages`가 만드는 user prompt는 전체 transcript + `"Now respond as Alex with your next single message."`뿐 — **speaking reason 한 줄이 없다.**
- 즉 모델은 항상 *"If no speaking reason is given, treat it as open_floor"* 경로로 가는데, 동시에 마지막의 "You recommend this candidate"(원인 1)가 recency로 이겨서 → **매 턴 open_floor인데도 추천을 강요하고 특질을 나열**한다.

> trigger(=언제 말하나)와 speaking reason(=무슨 성격으로 말하나)은 **다른 축**이다. 현재 시스템은 전자만 있고 후자는 프롬프트에만 있고 배선이 없다. **이 한 칸을 잇는 게 가성비 최고의 수정**이다. (golden 하베스트 `run-golden.ts`도 speaking reason을 안 줘서, 이 분기를 *테스트조차* 못 하고 있다.)

### 원인 3 — 출력 길이 하드캡 부재 + 취약한 zod 캡

`openai.ts → callAIStructured`는 `temperature:0`은 주지만 **`max_output_tokens`를 설정하지 않는다.** 길이를 누르는 유일한 장치는:

```ts
export const AIResponseSchema = z.object({ content: z.string().max(600) });
```

문제 둘:
1. **생성 단계 강제가 보장되지 않음.** OpenAI 구조화 출력에서 문자열 `maxLength` 강제는 모델/버전에 따라 들쭉날쭉하다 → `.max(600)`이 모델이 600자를 *생성하지 않도록* 보장하지 못할 수 있다.
2. **초과 시 무성 실패(턴 유실).** 모델이 600자를 넘기면 `responses.parse`의 zod 검증이 실패 → `output_parsed`가 null → `callAIStructured`가 `parsed_error` 반환 → `handleAITurn`이 이를 `stay_silent`로 로깅하고 **그 턴을 통째로 버린다.** 즉 너무 길면 짧아지는 게 아니라 **Alex가 침묵**한다. 이는 "대화가 안 된다"는 증상의 일부일 수 있다.

### 원인 4 — 라이브 경로의 컨텍스트 이중 주입 (드리프트 + 자기모방 + eval 불일치)

`handleAITurn`은 매 턴 (a) `buildUserPrompt`로 **전체 transcript**를 user 메시지에 넣고, **동시에** (b) 직전 AI 발화의 `previous_response_id`로 **체이닝**한다.

- 대화가 길어질수록 컨텍스트가 누적 → system prompt 앞부분의 간결성 지시가 *Lost-in-the-Middle*로 희석된다(업로드 문서가 말한 "context drift"의 실체).
- 체이닝은 모델이 **자기 과거의 (긴) 출력을 스타일 선례로 모방**하게 만든다 → 길이가 눈덩이처럼 커진다.
- **방법론적 함정:** `run-golden.ts`는 체이닝을 *안* 한다(케이스 독립). 따라서 **eval(짧게 나옴)과 라이브(체이닝으로 길어짐)가 달라서**, 오프라인에서 좋아 보여도 라이브에서 재현이 안 된다. 이건 §5 루프의 신뢰성을 직접 위협한다.

### 원인 5 (부차) — 모델 로깅 불일치

`aiTurn.ts`는 `model: "gpt-4o-mini"`를 하드코딩해 로깅하지만 실제 호출은 `callAIStructured`의 기본 `gpt-5.4-mini-2026-03-17`이다. → AIIntervention 로그의 모델 문자열이 **틀렸다.** 재현성·논문 보고 무결성에 직접 영향(어떤 모델이 데이터를 만들었는지 기록이 틀림).

### 진단 요약

| # | 원인 | 한 줄 | 고치는 레버 |
|---|---|---|---|
| 1 | 프롬프트 내부 모순 | "always mention all traits" + 마지막 "You recommend" vs 간결성 | C(런타임) / Tier2(frozen) |
| 2 | **Speaking-reason 미배선** | 이미 쓰인 분기를 런타임이 안 줌 → 매 턴 추천 강요 | **A ★** |
| 3 | 길이 하드캡 없음 | `max_output_tokens` 없음, zod캡은 무성 실패 위험 | B |
| 4 | 컨텍스트 이중 주입 | transcript + 체이닝 → 드리프트·자기모방·eval 불일치 | E |
| 5 | 모델 로깅 오류 | 실제 모델과 로그 불일치 | G |

---

## 3. 개선 레버 (효과·비용·리스크·실험타당성)

P0=즉시(저위험·고효과), P1=다음, P2=정리. "frozen 영향" = 동결 프롬프트(자극물)를 건드리는가.

| 레버 | 내용 | 우선 | 효과 | API비용 | frozen영향 | 타당성 리스크 |
|---|---|---|---|---|---|---|
| **A** | Speaking-reason를 런타임·eval에서 actuate | **P0** | ★★★ | 0 | 없음 | 낮음 (이미 설계됨) |
| **B** | `max_output_tokens` 캡 + zod캡 완화 + 파싱실패 비치명화 | **P0** | ★★ | 0 | 없음 | 낮음 (조건동일 고정) |
| **C** | OUTPUT_DISCIPLINE 강화 + few-shot 길이 캘리브레이션 | **P0** | ★★ | ~0 | 없음 | 낮음 |
| **D** | 별도 "speaking-reason judge" 패스 (GroupGPT 패턴) | P1 | ★★ | +작음 | 없음 | 중 (§4.3 주의) |
| **E** | 라이브 컨텍스트 정리(체이닝 제거 + 윈도우 transcript) | P1 | ★★ | −(절감) | 없음 | 낮음 (재현성↑) |
| **F** | 트리거 튜닝(대화 느낌) | P2 | ★ | 0 | 없음 | 낮음 (조건동일 유지) |
| **G** | 모델 로깅 수정 + 침묵 로깅 정합 | P2 | ★(무결성) | 0 | 없음 | 낮음 |
| **T2** | frozen System Constraints 스코프 재서술 | 선택 | ★★★ | 0 | **있음** | 중~높음 (§4) |

> **핵심 통찰:** P0 3개(A·B·C)는 **전부 frozen 프롬프트를 안 건드리고**, 추가 API 호출도 없이, 발화 과다의 원인 1~3을 직접 친다. 여기부터 시작하면 위험 없이 큰 효과를 본다.

---

## 4. Frozen 프롬프트: 2-Tier 결정 (네가 문서에서 고른다)

발화 과다의 *뿌리*(원인 1)는 동결 프롬프트 안에 있다. 그런데 그 문구는 (i) `common_framework.yaml`에 SHA-256 tripwire(`tests/frozen_common.test.ts`)로 잠겨 있고, (ii) 일부는 재현 대상 논문(Zercher et al.)에서 **그대로** 가져온 자극물이다. 그래서 두 갈래로 제시한다. **권고: Tier 1을 먼저 구현·측정 → 잔존 verbosity가 "직접 질문(directed) 턴"에 한정되면 그때 Tier 2를 좁게 적용.**

### Tier 1 — 안전: frozen 불변, 런타임/라우팅/토큰캡으로만 해결
- **무엇:** 레버 A·B·C·E·F·G만 적용. `common_framework.yaml`·`core_prompts/*.yaml`은 한 글자도 안 바꿈.
- **원리:** 원인 1의 "always mention all traits"는 frozen에 남지만, **레버 A의 speaking-reason가 그 발동을 "directed_followup / HP-OWN(특질을 명시적으로 물어본) 턴"으로 스코프**한다. 나머지 턴은 "add ONE focused point"가 이긴다. "You recommend"의 매-턴 강요도 speaking reason이 opening/open_floor/mediation에서 "give NO pick"으로 눌러준다.
- **장점:** 자극물 불변 → 재현성·IRB·peer review에 가장 안전. 되돌리기 쉬움.
- **한계:** "직접 특질을 물어본" 턴에서는 여전히 전체 나열이 나온다(이건 사실 **설계상 의도**일 수 있음 — 골든 케이스 HP-OWN이 "물어보면 전부 나열"을 정상으로 봄). 즉 Tier 1로 대부분 해결되고, 남는 건 "물어봤을 때만 긴" 정상 동작일 가능성이 높다.

### Tier 2 — 강력: frozen System Constraints를 "발화-이유 조건부"로 재서술
- **무엇:** `common_framework.yaml`의 `system_constraints`에서 무조건문을 **조건문**으로 바꾼다. 예:
  - `"Always mention all positive and all negative traits ... when asked about their traits."`
    → `"When a teammate explicitly asks for a candidate's full traits, list them compactly; otherwise contribute one focused point at a time."`
  - `"Always give a preference for exactly one candidate."`
    → `"When you give a preference (only when closing the discussion or when explicitly asked), commit to exactly one candidate with the highest current ratio."`
  - `[CRITICAL SYSTEM RULE]`의 `"You recommend this candidate"`는 ratio 규칙(판단 근거)은 유지하되, **선언 시점**을 routing에 위임하도록 한 문장 추가.
- **절차(반드시):** ① `tests/frozen_common.test.ts`의 SHA-256 기대값 갱신, ② PMS `pnpm run build:all`(또는 해당 조건만) 재실행 → Critic manipulation-check 재통과 확인, ③ `pnpm run export:hait`로 `compiled-prompts.json` 재생성, ④ 버전 범프 + `_audit`/CHANGELOG에 **변경 근거와 Zercher 원문 대비 차이**를 기록.
- **장점:** 원인 1을 뿌리째 제거 → 가장 강력.
- **리스크(과학적 함의):** 자극물이 바뀌므로 (a) 파일럿에서 manipulation check를 **재조작점검**해야 하고, (b) "원 연구에서 벗어난 부분"을 논문 Method에 **정당화**해야 한다. XAI의 "detailed explanations" 지각이 약해지지 않는지도 재확인 필요.

| 항목 | Tier 1 (런타임) | Tier 2 (frozen 편집) |
|---|---|---|
| 효과 | 대부분 해결 | 뿌리째 해결 |
| 자극물 변경 | 없음 | 있음 |
| 재현/IRB 리스크 | 최저 | 중~높음 (재조작점검·정당화) |
| 되돌리기 | 즉시 | 재빌드 필요 |
| 측정 후 판단 | **먼저 이걸로 측정** | 잔존 문제가 directed에 한정 안 될 때만 |

---

## 5. 근거 있는 품질 향상 루프 (eval) — "자체 멀티에이전트 + eval" 목표의 실현

너의 계획("자체 멀티 에이전트와 eval로 근거 있는 프롬프트 제작")은 거의 다 와 있다. **빠진 한 조각은 "발화 길이·자연스러움을 자동 채점하는 스코어러"다.**

### 5.1 현재 자산과 갭
- **PMS Critic** (`agent3_critic.ts`): Simulator(목 대화 생성)+Evaluator(manipulation-check Likert 채점)+`thresholds.yaml`(target≥4.5, opposite≤3.0). → **조작 강도**는 재지만 **간결·자연스러움은 안 잰다.**
- **서버 golden 하베스트** (`eval/run-golden.ts`+`golden_cases.yaml`, 11×4=36, temp0): 시나리오별 실제 출력을 md/json으로 뽑지만 **자동 채점이 없다**("채점 없음"이라고 주석에 명시).
- **갭:** 발화 길이/추천-강요/페이싱/페르소나를 재는 스코어러가 **어디에도 없다.** → 이게 추가할 한 조각.

### 5.2 추가할 것 — golden 하베스트에 자동 스코어러 부착 (대부분 룰 기반 = 공짜)

`run-golden.ts`의 각 출력 행에 점수 컬럼을 붙인다(LLM 호출 0, 순수 텍스트 분석):

- **간결성:** `chars`, `sentences`(마침표/물음표 분할), 게이트 위반 플래그.
- **Info-dump:** 한 문장 내 후보/특질 언급 수, 한 턴 신규 특질 노출 수(Z-set 매칭).
- **추천 강요:** open_floor/build/mediation 케이스에서 "recommend/preference/strongest/my pick" 정규식 매칭 → **non-closing 턴의 pick = 위반.**
- **페르소나/축:** 기존 `lint_rules.yaml` 재사용 — peer 턴에 agenda-setting 동사, XAI 턴에 `aci_forbidden_vocab`("ask","what do you think"), ACI 턴에 `xai_forbidden`... 역으로 매칭.
- **(선택) 자연스러움 LLM-judge 1개:** 작은 모델로 표본만 1~5 라벨("사람 동료 같은가"). 비용 통제 위해 전수 아님.

산출: 기존 `baseline_*.md` 옆에 `scored_*.md`(케이스×조건 점수표) + `summary.json`(중앙값/위반율). 변형 프롬프트를 돌릴 때마다 **베이스라인 대비 델타**를 자동 비교.

### 5.3 루프 (라이브 피험자 0명, 비용 센트 단위)

```
프롬프트/레버 변형  →  run-golden(36런, temp0)  →  스코어러  →  베이스라인 대비 델타
   ↑                                                                      │
   └───────────────── 게이트 통과 못 하면 다음 변형 ──────────────────────┘
   통과 → export:hait → (선택) 소규모 라이브 확인
```

이게 "비싸서 다 못 해본다"의 해법이다. 수십 개 프롬프트 변형을 **오프라인에서 싸게** 비교하고, 통과한 것만 라이브로 올린다.

### 5.4 게이트 예시 (조건별로 다르게 — 숫자는 파일럿으로 보정)

| 게이트 | ACI(질문 중심) | XAI(설명 중심) | 공통 |
|---|---|---|---|
| 메인 턴 중앙값 길이 | ≤ ~220자 / ≤2문장 | ≤ ~320자 / ≤3문장 | — |
| open_floor 턴 pick 발생률 | 0% | 0% | non-closing pick=0 |
| 한 턴 신규특질 노출 | ≤2 | ≤3 | 한 문장 비교 ≤1 |
| manipulation 축 유지 | ACI 지각 ↑ | XAI 지각 ↑ | lint 위반=0 |

> **중요:** 간결성 게이트와 manipulation check를 **동시에** 본다. XAI를 너무 깎으면 "detailed explanations" 지각이 떨어진다. 그래서 XAI는 ACI보다 관대하게.

---

## 6. 구체 구현 (바로 적용 가능)

> 아래는 P0 중심의 실제 패치 스케치다. 심볼·파일은 현재 코드 기준.

### 6.A — Speaking-reason actuate (레버 A) ★

**A-1. 매핑 함수 (신규, 예: `server/src/lib/speakingReason.ts`)**
```ts
import type { SessionContext } from "../triggers/types.js";

export type SpeakingReason =
  | "opening" | "open_floor" | "build_on"
  | "directed_followup" | "mediation" | "closing";

// 런타임 신호 → 발화 이유. 타이밍(trigger)과 분리된 "성격" 축.
export function resolveSpeakingReason(
  ctx: SessionContext,
  opts: { isClosing?: boolean; lastHumanText?: string },
): SpeakingReason {
  if (opts.isClosing) return "closing";
  if (ctx.secondsSinceLastAI === null) return "opening";        // AI 첫 발화
  const t = (opts.lastHumanText ?? "").toLowerCase();
  if (/\?|what about|do you|can you|alex/.test(t)) return "directed_followup"; // 직접 질문/호명
  if (ctx.messagesSinceLastAI >= 5) return "mediation";          // 사람끼리 길게 진행 → 풀링 재개
  return "build_on";                                             // 기본: 직전 발언에 한 포인트
}
```

**A-2. user prompt에 한 줄 주입 (`prompts.ts`)**
```ts
export function buildUserPromptFromMessages(
  messages: { sender: string; content: string }[],
  reason?: SpeakingReason,            // ← 추가
): string {
  const head = reason ? `[Speaking reason: ${reason}]\n` : "";
  if (messages.length === 0)
    return `${head}[No messages yet. The discussion is about to begin.]`;
  const transcript = messages
    .map((m) => `${m.sender}: ${m.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");
  return `${head}Discussion so far:\n${transcript}\n\n---\nNow respond as Alex with your next single message.`;
}
```
프롬프트가 이미 `By speaking reason:` 분기를 이해하므로, **이 한 줄이 잠자던 로직을 깨운다.** `handleAITurn`에서 `resolveSpeakingReason(ctx, {...})`를 호출해 `buildUserPrompt(sessionId, reason)`로 넘기면 끝. **`run-golden.ts`에도 동일하게** 케이스의 `phase`(main/closing)와 마지막 화자 텍스트로 reason을 만들어 주입 → 비로소 분기를 테스트할 수 있다.

### 6.B — 길이 하드캡 + 파싱 안전화 (레버 B) (`openai.ts`)
```ts
const response = await client.responses.parse({
  model,
  temperature: 0,
  max_output_tokens: 140,          // ← 추가. 4조건 동일 값으로 고정(통제 유지). ACI는 더 낮춰도 됨.
  input: [...],
  previous_response_id: previousResponseId,
  text: { format: zodTextFormat(AIResponseSchema, "ai_response") },
});
```
- `AIResponseSchema`의 `.max(600)` → 길이는 토큰캡으로 누르고, zod 캡은 **여유 있게(예: 800)** 또는 제거해 **무성 실패(턴 유실)를 없앤다.**
- 파싱 실패를 비치명화: `output_parsed`가 null이면 한 번 **짧게 재시도**(또는 `output_text` 트런케이트 폴백)하고, 그래도 실패할 때만 `stay_silent` 로깅.

### 6.C — OUTPUT_DISCIPLINE 강화 + few-shot (레버 C) (`prompts.ts`)
- 현재 discipline 유지하되 길이를 **수치로** 고정: *"Keep it to 1–2 sentences (≈ under 280 characters) unless a teammate explicitly asks for a candidate's full traits."*
- **짧은 few-shot 1~2개**를 discipline 끝에 첨부(golden `hint` 스타일). 모델은 길이를 예시에서 잘 캘리브레이션한다. 단 예시는 **중립 케이스**로(특정 후보 선호가 새지 않게).

### 6.D — Speaking-reason judge 패스 (레버 P1, GroupGPT 패턴)
- 작은/싼 모델로 맥락 → `{"speak": true|false, "reason": "..."}`을 먼저 분류하고, 본 생성에 reason 주입.
- **이점:** (1) 지금은 트리거되면 *무조건* speak인데(설계상 "성공 시 항상 speak"), judge가 진짜 **stay_silent**를 준다 → 끼어듦 과잉 완화. (2) reason 정확도↑. (3) **논문 인용 근거**: GroupGPT(arXiv 2026) — "small–large collaborative architecture to *decouple intervention timing from response generation*", intervention judge가 `{choice, reason}` 또는 `Stay Silent` 출력.
- **★ 실험타당성 주의(중요):** GroupGPT는 *개입 타이밍 정확도*를 최적화하지만, **너의 설계 §4.3은 타이밍을 상수로 고정**한다. 따라서 judge에게 **타이밍 결정을 맡기면 IV 통제가 깨진다.** judge는 **(a) reason 분류와 (b) speak/silent 여부**에만 쓰고, **타이밍은 기존 규칙(triggers)으로 고정** 유지. (judge의 silent도 조건 간 체계적 차이를 만들면 안 되므로, 4조건 동일 모델·동일 컷오프·로깅 필수.)

### 6.E — 라이브 컨텍스트 정리 (레버 P1) (`aiTurn.ts`)
- **체이닝(`previous_response_id`) 제거** + user prompt를 **윈도우 transcript**(예: 최근 12~16턴)로. → (1) 드리프트·자기모방 감소, (2) **eval(무체이닝)과 라이브가 일치** → §5 루프가 라이브를 예측. (3) 재현성↑(상태 의존 제거).
- 트레이드오프: 아주 긴 토론의 초반 정보를 잊을 수 있음 → Hidden Profile은 "이미 공유된 정보"가 transcript에 남아 윈도우가 충분하면 문제 적음. 윈도우 크기를 eval로 보정.

### 6.G — 로깅 정합 (레버 P2)
- `aiTurn.ts`의 `model: "gpt-4o-mini"` → 실제 사용 모델 문자열로(또는 `result`에서 받아 기록). 침묵/발화 로깅 의미도 정리(성공인데 침묵 선택 vs 실패).

---

## 7. 실행 순서 (3일 스프린트 예시)

- **Day 1 (P0, 저위험·고효과):**
  - 레버 B(`max_output_tokens`=140, zod캡 완화) + G(로깅 수정) — 30분, 즉효.
  - 레버 A(speaking-reason 매핑+주입)를 **런타임과 `run-golden.ts` 동시** 적용.
- **Day 2 (측정 루프 가동):**
  - §5.2 스코어러를 `run-golden.ts`에 부착 → 베이스라인 재측정.
  - A/B 테스트(오프라인): reason on/off, 토큰캡 100 vs 140, discipline 강화 유무 → 델타 비교. 통과안만 채택.
- **Day 3 (정합·선택):**
  - 레버 E(체이닝 제거 + 윈도우) 적용 후 eval↔라이브 일치 확인.
  - 잔존 verbosity가 directed 턴에 한정되지 *않으면* → **Tier 2**를 좁게 적용(SHA 갱신→PMS 재빌드→export).
  - 레버 D(judge)는 P1로 분리해 별도 스프린트.
- 각 단계 끝에 golden 델타로 회귀 확인. 라이브는 통과한 변형만, 소규모로.

---

## 8. 오픈소스 활용 결론 (Gradio / GroupGPT)

| 오픈소스 | 교체용? | 실제 쓸모 | 근거 |
|---|---|---|---|
| **Gradio** | ❌ 참가자 런타임 대체 부적합 | (선택) 연구자 전용 *단일 사용자* 프롬프트 플레이그라운드. 단 이미 golden md/json이 있어 필수는 아님 | `gr.State`는 세션별, 동시 사용자 세션이 **섞임**; 동기화 다자 룸은 비네이티브 → 현재 Socket.IO 런타임이 더 우수 (출처) |
| **GroupGPT** | ❌ 코드 드롭인 부적합(가중치·MUIR 데이터 게이트, 범용 intervention taxonomy) | ✅ **패턴 + 논문 인용**으로 레버 D의 근거. "judge가 reason/stay-silent를 결정, 생성과 분리" | arXiv 2026; intervention judge `{choice, reason}`/`Stay Silent`, "decouple intervention timing from response generation" |

> 결론: **현재 Socket.IO 런타임 유지가 정답.** 오픈소스는 "교체"가 아니라 **"GroupGPT의 judge 패턴 차용"(타이밍 제외)**으로만 쓴다. Gradio는 굳이 도입 안 해도 된다.

---

## 9. 한 페이지 요약

- **문제의 뿌리:** 모델이 아니라 (1) frozen 프롬프트의 간결성↔철저함 모순, (2) 이미 작성됐지만 **배선 안 된 speaking-reason 라우팅**, (3) 출력 토큰 하드캡 부재. (오늘 golden 베이스라인이 증거.)
- **가장 가성비 높은 한 수:** **레버 A** — trigger(언제) ↔ speaking reason(성격)을 잇는 한 줄 주입. frozen 불변, 추가 호출 0, 잠자던 방어 로직("매 턴 추천하지 마라")을 깨움.
- **즉시 안전 조치:** **레버 B**(`max_output_tokens` + 무성 실패 제거), **C**(discipline 수치화 + few-shot).
- **frozen은 2-tier:** Tier 1(런타임만)로 먼저 측정 → 남으면 Tier 2(스코프 재서술, 재조작점검 동반).
- **싸게 반복:** golden 하베스트에 **자동 스코어러**를 붙여 라이브 0명으로 수십 변형 비교(§5). 단 **레버 E로 eval↔라이브를 일치**시켜야 루프가 믿을 만하다.
- **오픈소스:** GroupGPT는 **패턴·인용**으로만(타이밍 결정은 §4.3 위반이라 차용 금지), Gradio는 런타임 대체로 부적합.

---

### 출처
- GroupGPT — [Eliot-Shen/GroupGPT (GitHub)](https://github.com/Eliot-Shen/GroupGPT) · arXiv 2026 "GroupGPT: A Token-efficient and Privacy-preserving Agentic Framework for Multi-User Chat Assistant"
- Gradio 멀티유저 한계 — [Interface State (Gradio Guide)](https://www.gradio.app/guides/interface-state) · [Issue #8561 concurrent users mixing](https://github.com/gradio-app/gradio/issues/8561) · [Issue #9983 multi-user gr.State conflict](https://github.com/gradio-app/gradio/issues/9983)

### 근거가 된 코드 (HAIT)
- `server/src/lib/prompts.ts` (OUTPUT_DISCIPLINE, buildUserPromptFromMessages), `server/src/lib/openai.ts` (callAIStructured, AIResponseSchema, max_output_tokens 부재), `server/src/lib/aiTurn.ts` (speaking-reason 미주입, previous_response_id 체이닝, 모델 로깅)
- `server/src/lib/compiled-prompts.json` (Speaking-Reason Routing / System Constraints / [CRITICAL SYSTEM RULE])
- `server/src/triggers/*`, `server/src/config/triggers.ts` (타이밍)
- `server/src/eval/run-golden.ts`, `server/src/eval/golden_cases.yaml`, `server/src/eval/out/baseline_2026-06-08T04-29-11-436Z.md` (실측 증거)
- `prompt-management-system/` — `agent3_critic.ts`, `config/{thresholds,manipulation_checks,lint_rules,common_framework}.yaml`, `tests/frozen_common.test.ts`, `scripts/export_to_hait.ts`
