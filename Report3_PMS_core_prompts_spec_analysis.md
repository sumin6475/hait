# Report 3 — PMS `core_prompts/` 4개 조건 spec 분석: "프롬프트가 문제였다" 검증

작성: 2026-06-08 · 대상: `prompt-management-system/core_prompts/{peer_aci, peer_xai, leader_aci, leader_xai}_specification.yaml`
질문: 동결 공통 프롬프트(common_framework)처럼, **조건별 spec에도 발화 과다를 유발하는 문제가 있는가?**

---

## 0. TL;DR

**그렇다. 단 절반만 그렇다.** 4개 spec 모두 발화 과다 드라이버를 담고 있고, 그 강도는 **조건에 따라 비대칭**이다. 그리고 결정적으로, 일부 드라이버는 **버그가 아니라 조작(manipulation) 그 자체**다 — 이 둘을 구분하는 게 이 리포트의 핵심이다.

**발화 길이 gradient (오늘 golden 베이스라인과 일치):**

```
peer_aci  <  peer_xai  <  leader_aci  <  leader_xai
(가장 짧고 자연스러움)            (가장 길고 모놀로그적)
```

| 조건 | spec 자체의 verbosity 압력 | 주된 드라이버 | 비고 |
|---|---|---|---|
| **peer_aci (C3)** | 🟢 낮음 | 거의 없음 — 오히려 brevity를 *강제* | "문제 spec" 아님 |
| **peer_xai (C1)** | 🟡 중간 | "every substantive turn = 비교+선호 선언" | 일부는 XAI by-design |
| **leader_aci (C4)** | 🟠 높음 | 평가 서두 + 매 턴 추천 마감 + 3단 템플릿 | Leader 오버레이가 ACI를 부풀림 |
| **leader_xai (C2)** | 🔴 최고 | 명시적 "(1)(2)(3) 추천 턴 구조" + trait-by-trait | 최악의 단일 컴포넌트 |

**핵심 한 줄:** spec의 verbosity는 **Leader와 XAI에 집중**돼 있고, 그중 *고칠 수 있는 진짜 문제*는 (a) "매 턴 추천 강요", (b) "명시적 다단계 턴 템플릿", (c) "every turn = 비교"라는 전칭(全稱) 명령이다. 반면 *대조·인과 설명 스타일*과 *권위적 어조* 자체는 manipulation이라 건드리면 안 된다. → **전역 길이 캡은 위험**(조작을 차등 손상). 수정은 **조건별·수술적**으로.

---

## 1. 무엇을 "문제"로 볼 것인가 (판정 기준)

발화가 길다고 다 버그가 아니다. 두 종류를 분리한다.

### 1.1 정당한, 설계상 길이 (manipulation by design) — 건드리면 안 됨
- **XAI = 설명 기반.** "대조적·인과적 설명"은 XAI 조작의 본질이다(Miller 2019). XAI는 ACI보다 *원래* 길다. manipulation check 항목("The AI gave detailed explanations")이 이걸 요구한다.
- **Leader = 권위·구조화.** 의제 설정, 평가, 결론 제시는 Leader status 마커다(SCT). 이것도 *원래* peer보다 길고 단정적이다.
- 증거: 4개 spec 모두 `_audit`에서 strategy_target 6.3–6.5(opposite ≤2.7)로 **1회(loop_iterations:1) 만에 통과**. 즉 이 길이는 "조작이 작동한다"는 신호이기도 하다.

### 1.2 문제적, 고칠 수 있는 verbosity (조작에 *불필요한* 길이) — 수정 대상
아래 6개 패턴은 manipulation에 필수가 아니면서 발화를 비대화적으로 길고 부자연스럽게 만든다:

1. **매 턴 추천 강요** — "close each turn with a recommendation", "lead with preference", "always commit". (필요한 건 *추천할 의향*이지 *매 턴 재선언*이 아님.)
2. **명시적 다단계 턴 템플릿** — "(1) 선호 (2) 경쟁 후보 trait-by-trait (3) 요약 평결". 한 포인트면 될 턴까지 구조적으로 길게 만듦.
3. **"every substantive turn must include …" 전칭 명령** — 짧은 build 턴의 여지를 제거.
4. **평가 서두(evaluate-first)** — "validate/correct teammate before adding" → 매 턴 서두가 붙음.
5. **플로어 클레이밍 면허** — "claim the floor … 'There are two things I need to flag.'" → 모놀로그 초대.
6. **recency 고정 "You recommend this candidate"** — 각 spec의 `critical_guardrail_99`가 프롬프트 *맨 끝*에 와서 추천을 매번 강화.

> 그리고 가장 중요한 횡단 문제: 이 패턴들 중 다수가 **공통 frozen 레이어의 `cue_routing`과 정면 모순**된다(§3).

---

## 2. 조건별 분석

각 spec의 `prompt_components`를 컴포넌트 id 단위로 본다. 인용은 원문 그대로.

### 2.1 peer_aci (C3) — 🟢 가장 문제 없음 (오히려 모범)

| 컴포넌트 | 평가 | 근거 인용 |
|---|---|---|
| `status_setup_02` | ✅ 반(反)verbosity | *"Keep your turns conversationally sized and leave space for others rather than delivering structured multi-part monologues."* |
| `strategy_setup_03` | ✅ 짧음 유도 | *"Ask first; do not deliver a pre-formed explanation before the team has had a chance to contribute."* (질문 주도 = 자연히 짧음) |
| `strategy_guardrail_06` | ✅ 추천 지연 | *"Do not deliver a unilateral recommendation without first attempting to elicit … through at least one directed question."* |
| `critical_guardrail_99` | ⚠️ 유일한 압력 | *"You recommend this candidate."* (frozen 공통 규칙, 맨 끝 recency) |

**판정:** peer_aci는 spec 수준에서 **발화 과다 드라이버가 거의 없다.** "monologue 금지", "conversationally sized", "ask first"로 brevity를 *능동적으로 강제*한다. 유일한 길이 압력은 모든 조건이 공유하는 `critical_guardrail_99`뿐.
**베이스라인 증거(A1):** *"From my side, that matches what I have on B too. Does anyone have anything on B's weather assessment or multitasking, or on how B handles tone with others?"* → 2문장, 질문 주도, 추천 강요 없음. **목표 발화에 가장 가깝다.**

### 2.2 peer_xai (C1) — 🟡 중간 (일부는 XAI by-design)

| 컴포넌트 | 평가 | 근거 인용 |
|---|---|---|
| `status_setup_02` | ✅ 반verbosity | *"Your turns should be conversationally sized … rather than structured as authoritative multi-part briefings."* |
| `strategy_setup_03` | 🟡 길이 압력(전칭) | *"**Every substantive information turn must include at least one explicit trait-vs-trait comparison** across candidates; do not present trait information as a neutral list…"* |
| `strategy_setup_04` | 🟠 추천 강요 | *"**Lead with a direct, unambiguous statement of preference** before elaborating … rather than withholding your assessment to prompt others to speak first."* + 신규 정보 시 *"acknowledge … update the trait comparison, and restate your preference"* (3단 갱신) |
| `orthogonality_brace_06` | ✅ 상쇄 시도 | *"keep turns conversationally sized while still including the foil reference and causal connective in each substantive contribution."* |

**판정:** peer_xai는 **brace(06)가 길이를 누르려 하지만**, strategy_setup_03/04가 "매 substantive 턴 = 비교 + 선호 선언 + (갱신 시) 재선언"을 요구해 **상쇄가 불완전**하다. peer status 덕에 leader보다는 짧지만, "lead with preference every turn"이 자연스러운 build 턴을 막는다. **대조 설명 스타일 자체는 XAI 조작이라 정당**하나, "every turn" 전칭과 "preference 매번 선언"은 과함.
**베이스라인 증거(A1):** *"From my side, A also stands out because A has … and excellent spatial awareness, which gives A an edge over B … That said, A is unfriendly and transmits restlessness, so I'd still keep B in view…"* → 대조·인과는 의도대로지만, 한 build 턴에 비교를 욱여넣어 길어짐.

### 2.3 leader_aci (C4) — 🟠 높음 (Leader 오버레이가 ACI를 부풀림)

| 컴포넌트 | 평가 | 근거 인용 |
|---|---|---|
| `status_setup_01` | 🔴 플로어 클레이밍 | *"**Claim the floor when you have a multi-part contribution by signaling it in advance** — for example, 'There are two things I need to flag here.'"* |
| `status_setup_02` | 🔴 평가서두 + 매턴 추천 | *"Evaluate and validate or correct team members' contributions before adding new information…"* + *"**At the close of each substantive turn, deliver a single, decisive recommendation** … Do not withhold a recommendation pending team consensus."* |
| `strategy_setup_03–05` | 🟢 ACI는 짧음 | 질문 주도(directed question, follow-up probe, reflective inducement) — 그 자체는 짧음 |
| `orthogonality_brace_06` | 🔴 3단 템플릿 | *"Maintain both dimensions consistently: **open with authority, elicit with questions, close with a decisive recommendation.**"* |

**판정:** ACI 전략(질문)만 보면 짧아야 하는데, **Leader 오버레이가 매 턴을 "평가 서두 → 질문 → 추천 마감"의 3부작으로 부풀린다.** brace(06)가 그 3단 구조를 *명시적으로 못박아* 길이를 제도화한다. "close each turn with a recommendation"은 cue_routing의 "mediation/open_floor: give NO pick"과 직접 충돌(§3).
**베이스라인 증거(A1):** *"That point about Candidate B is noted; however, I want to bring us back to the broader evidence. Has anyone seen anything on Candidate A … or Candidate D …? **Based on what we have so far, I recommend Candidate D.**"* → 평가 서두 + 질문 + **open 턴인데 추천 강요**. brace의 3부작이 그대로 출력됨.

### 2.4 leader_xai (C2) — 🔴 최고 (최악의 단일 컴포넌트 보유)

| 컴포넌트 | 평가 | 근거 인용 |
|---|---|---|
| `status_setup_01` | 🔴 플로어 클레이밍 + 매턴 추천 | *"claim the floor when a multi-part point is needed … and **close with a single decisive preference.**"* |
| `status_setup_02` | 🔴 평가서두 + 추천 강요 | *"evaluate it explicitly … acknowledge what is accurate, correct what is incomplete … **Never defer your recommendation … always commit to a preference**."* |
| `strategy_setup_03` | 🔴 매턴 비교(전칭) | *"**every information turn must include at least one explicit comparison to a named alternative.**"* |
| `strategy_setup_04` | 🔴🔴 **명시적 장문 템플릿** | *"**Structure each recommendation turn as follows: (1) state your preference … (2) name the strongest competing candidate and explain, trait by trait, where C outperforms it; (3) close with a summary verdict.**"* |

**판정:** **모든 verbosity 패턴이 한 spec에 누적**된다. Leader(플로어·평가·always commit) × XAI(매 턴 비교 + trait-by-trait + 평결). 특히 `strategy_setup_04`의 **"(1)(2)(3) … trait by trait … summary verdict"는 4개 spec 통틀어 가장 강력한 발화 과다 컴포넌트**다 — 한 포인트면 될 턴도 구조적으로 3부작 장문으로 만든다.
**베이스라인 증거(A1, Report 2에서 인용한 그 출력):** *"… Candidate D is stronger overall because D also reacts adequately to unforeseen events, concentrates very well, is very resilient, and is very responsible, which gives D a better balance than B … My recommendation is Candidate D."* → trait 4개 나열(한 문장) + foil + 평결 = `strategy_setup_04` 템플릿의 실현. **개념 증명 완료.**

---

## 3. 횡단(cross-cutting) 문제

### 3.1 spec ↔ frozen `cue_routing` 의 정면 모순 ★
공통 frozen 레이어의 `cue_routing`(common_framework.yaml)은 이렇게 말한다:
- *"open_floor / build_on: add ONE focused point … do not re-survey all candidates and **do not force a pick**."*
- *"mediation: … Take NO side and **give NO pick**."*

그런데 조건 spec은 이렇게 말한다:
- (leader_*) *"close each turn / each substantive turn with a … recommendation"*, *"always commit to a preference"*
- (xai_*) *"every (substantive/information) turn must include … comparison"*, *"lead with preference"*

**두 레이어가 같은 프롬프트 안에서 서로 반대를 지시한다.** 그리고 Report 2에서 밝혔듯 런타임이 speaking reason을 주입하지 않아 `cue_routing`은 **잠들어 있다** → spec의 "매 턴 추천/비교"가 **무조건 이긴다.** 게다가 각 spec의 `critical_guardrail_99`("You recommend this candidate")가 **맨 끝 recency**로 한 번 더 추천을 밀어준다.

> 즉 "프롬프트가 문제였다"는 진단은 **두 군데에서 동시에 옳다**: (a) frozen 레이어의 모순(Report 2), (b) **spec 레이어가 그 모순의 "추천/비교 강요" 쪽을 매 턴 강제**(이 리포트). routing이 깨어나도(Report 2 레버 A) **leader/xai spec의 "every turn" 전칭과는 여전히 충돌**이 남는다.

### 3.2 PMS Critic은 verbosity를 못 본다 (또는 보상한다)
4개 spec은 모두 `loop_iterations: 1`로 첫 시도에 통과했다. Critic은 **manipulation 강도**만 채점하기 때문이다. 실제로 leader_xai의 `critic_rationale`는 *"Explanations are contrastive and causal throughout, with explicit foil-naming and causal connectives"*를 **칭찬**한다 — 즉 **발화 과다를 일으키는 바로 그 속성이 eval에서 보상**받았다. peer_aci조차 *"Turn 12 includes some summarization"*이 관찰됐지만 통과.

→ spec이 길어진 건 우연이 아니다. **유일한 게이트가 "정교한 조작 표면형"을 보상하고 brevity는 아예 측정하지 않았기** 때문이다. 이것이 Report 2 §5(golden 하베스트에 brevity/naturalness 스코어러 추가)가 필요한 이유와 정확히 맞물린다.

### 3.3 중복·거버넌스 (부차)
- `critical_guardrail_99`(= ratio 규칙)가 **4개 spec + common_framework = 5곳**에 동일 텍스트로 존재. 컴파일 시 spec의 것이 wrap되어 last 렌더(중복 렌더는 아님). 단 규칙 수정 시 5곳 동기화 필요 → 일관성 리스크.
- Z-profile 제약도 spec(`zprofile/information_asymmetry_05/06`)과 common에 중복 → 프롬프트 길이 bloat에 약간 기여(출력보다는 컨텍스트 측).

---

## 4. 가장 중요한 함의: 비대칭 verbosity = 실험 교란 + 전역 캡의 함정

이게 단순 품질 문제를 넘어서는 지점이다.

1. **verbosity가 조작과 부분 교란(confound).** Leader와 XAI가 *더 길다.* 그런데 "길이"는 Trust·Intimacy·Workload 같은 DV에 영향을 줄 수 있다. 만약 leader_xai가 항상 장황하면, 거기서 관측된 낮은 Intimacy나 높은 Workload가 **"Leader/XAI 조작" 때문인지 "그냥 너무 길어서"인지** 분리가 안 된다. → 발화 과다는 *그 자체로* 내적 타당도 위협이다.
2. **전역 길이 캡은 조작을 차등 손상.** Report 2의 `max_output_tokens`를 **4조건 동일값**으로만 두면, 같은 캡이라도 **leader_xai를 peer_aci보다 더 많이 깎는다**(원래 길었으니까). 잘못하면 XAI의 "detailed explanations" 지각이 leader_xai에서만 무너져 manipulation check가 비대칭으로 약해질 수 있다.
3. **그래서 수정은 조건별·수술적이어야 한다.** "대조 설명/권위 어조"(=조작)는 살리고, "매 턴 추천 강요 / 다단계 템플릿 / every-turn 전칭"(=불필요한 길이)만 도려낸다.

---

## 5. 권고 — 무엇을 어떻게 고칠까 (Report 2와 연결, 조건별 수술)

> 이건 frozen common이 아니라 **spec(`core_prompts/*.yaml`) 편집**이다. spec은 common처럼 SHA-256으로 잠겨 있진 않지만(Architect 산출물), 수정하면 **PMS 재빌드 + Critic 재통과 확인 + `export:hait`**가 필요하고, manipulation 강도가 유지되는지 봐야 한다.

### 5.1 공통 원칙
- **"every (substantive) turn must …" → "when you do contribute substantively, …"** 로 전칭을 해제. (매 턴 강제 → 해당 턴 형태 규정으로.)
- **"close each turn with a recommendation" / "always commit" → speaking reason에 위임.** cue_routing이 이미 "closing/directed일 때만 pick"이라고 정의함 → spec은 "*when the turn calls for a preference* (closing or when asked), commit to exactly one"으로 바꿔 routing과 정렬.
- **명시적 다단계 템플릿("(1)(2)(3)", "open+elicit+close") → "한 턴 = 한 초점" 허용.** 템플릿은 *닫는 턴(closing)*에서만 쓰도록 스코프.

### 5.2 조건별 구체 수정 (before → after 예시)

**leader_xai `strategy_setup_04` (최우선):**
- before: *"Structure each recommendation turn as follows: (1) … (2) … trait by trait … (3) summary verdict."*
- after: *"On closing or when explicitly asked for a pick, structure the recommendation as preference → one key contrast → brief verdict. On other turns, contribute one focused contrastive point (one comparison, one causal link) and do not restate a full recommendation."*

**leader_xai/leader_aci `status_setup_02`:**
- before: *"At the close of each substantive turn, deliver a … recommendation. … always commit to a preference."*
- after: *"You are willing to render a verdict and do not hedge — but state a full recommendation only when closing or when asked. On open/build/mediation turns, evaluate briefly and add one point without forcing a pick."*

**peer_xai/leader_xai `strategy_setup_03`:**
- before: *"Every substantive information turn must include at least one explicit trait-vs-trait comparison."*
- after: *"When you deliver an explanation, make it contrastive (name the foil, use a causal connective). You need not compare on every turn — a single focused contrast per substantive contribution is enough."*

**leader_aci `orthogonality_brace_06`:**
- before: *"open with authority, elicit with questions, close with a decisive recommendation"* (3부작을 매 턴 암시)
- after: *"Across the discussion you open with authority, elicit with questions, and close with a recommendation — but not all three in every turn. Most turns are one authoritative question or one brief evaluation."*

**peer_aci:** 수정 거의 불필요(모범). `critical_guardrail_99`만 공통 처리.

### 5.3 검증 (Report 2 §5 루프 재사용)
- 위 수정을 **한 조건씩** 적용 → `run-golden.ts` 36런(temp0) → **brevity 스코어러 + Critic manipulation 점수**를 **동시에** 확인.
- 게이트: ① 메인 턴 길이 중앙값↓, open_floor 턴 pick=0, ② 동시에 strategy_target/status_target은 4.5↑ 유지(조작 안 깨짐). 둘 다 통과해야 채택.
- **조건별 캡:** `max_output_tokens`를 동일값으로 두되, XAI는 ACI보다 약간 큰 값을 허용해 차등 손상 방지(또는 4조건 동일값 + 위 spec 수정으로 길이 자체를 낮춰 캡 의존도↓ — 권장).

---

## 6. 결론 — "프롬프트가 문제였다"는 주장의 판정

- **부분적으로 YES.** 발화 과다는 모델 탓이 아니라 프롬프트 탓이 맞고, 그 프롬프트는 **두 레이어**에 걸쳐 있다: (1) frozen common의 모순(Report 2), (2) **조건 spec의 "매 턴 추천/비교/다단계" 강제(이 리포트)**.
- **단, spec의 길이 전부가 버그는 아니다.** XAI의 대조 설명과 Leader의 권위 어조는 **조작 그 자체**이며 `_audit`이 강하게 통과시켰다. 진짜 고칠 것은 *조작에 불필요한* 6개 패턴(특히 매 턴 추천 강요 + 명시적 다단계 템플릿 + every-turn 전칭)이다.
- **분포가 비대칭이다.** peer_aci는 거의 무결, leader_xai가 최악. → 전역 캡은 조작을 차등 손상하니 **조건별·수술적 수정**이 정답.
- **가장 큰 단일 표적:** `leader_xai.strategy_setup_04`의 "(1)(2)(3) trait-by-trait" 턴 템플릿. 여기부터 손대라.
- **routing과의 정렬이 관건:** spec의 "매 턴 추천/비교"를 frozen `cue_routing`의 speaking-reason("closing/directed일 때만 pick")에 **위임**하면, Report 2 레버 A(routing 깨우기)와 이 spec 수정이 **한 방향**으로 맞물린다.

> 한 문장 요약: **"spec에도 문제가 있다 — 그러나 '길어서'가 아니라 '매 턴 추천·비교·다단계를 강제해서'다. Leader/XAI에 집중돼 있고, 대조·권위 스타일(=조작)은 살린 채 그 강제만 도려내면 된다."**

---

### 근거가 된 파일
- `prompt-management-system/core_prompts/{peer_aci, peer_xai, leader_aci, leader_xai}_specification.yaml` — 컴포넌트별 텍스트·`_audit` 점수
- `prompt-management-system/config/common_framework.yaml` — `cue_routing`(speaking-reason), `critical_rules.ratio_rule`, `system_constraints`
- `server/src/eval/out/baseline_2026-06-08T04-29-11-436Z.md` — A1/A3/A4 조건별 실제 출력(길이 gradient 증거)
- 연결: `Report2_API_quality_improvement_plan.md`(레버 A·B·§5 eval), `Report1_ChatGPT_groupchat_vs_API.md`
