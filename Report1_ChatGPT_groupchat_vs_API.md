# Report 1 — ChatGPT 그룹챗 vs. API 시스템: 플랫폼 결정 리포트

작성: 2026-06-08 · 대상 실험: HAIT (Human–AI Team) Hidden Profile 2×2 연구
검토 자료: 실험설계서(Experimental Design), 업로드 분석문서(chatgpt_vs_api), 현재 빌드된 HAIT 코드베이스(client/server/prompt-management-system), ChatGPT 그룹챗 공식 사실(2025-11 출시 기준)

---

## 0. TL;DR (먼저 결론)

**현재 API 시스템을 유지한다. ChatGPT 그룹챗으로 갈아타는 것은 "더 쉬운 길"이 아니라 "실험이 성립하지 않는 길"이다.**

이건 도구 편의성(개발 시간·비용)의 문제가 아니라 **실험이 측정 가능한가**의 문제다. 너의 실험설계서가 플랫폼에 요구하는 4가지 핵심 통제 중 **3가지를 ChatGPT 그룹챗은 구조적으로 제공할 수 없다**:

| 실험 요구사항 (설계서) | ChatGPT 그룹챗 | 현재 API 시스템 |
|---|---|---|
| ① 개입 타이밍을 4조건에서 **상수로 고정** (§4.3) | ❌ AI가 자율 판단 또는 사람이 수동 @멘션 | ✅ `triggers/*.ts` 코드로 밀리초 단위 통제 |
| ② AI에게 **Z-profile만** 주고 사람의 X·Y는 격리 (§4.4, IV의 핵심) | ❌ 채팅에 올라온 모든 정보를 AI가 즉시 인지 → IV 실시간 오염 | ✅ `compiled-prompts.json`에 Z-profile만 주입, 서버가 정보 통제 |
| ③ 조건별/참가자별 **다른 시스템 프롬프트** (2×2 조작) | ❌ 그룹 지침은 방 전체 1세트 | ✅ C1–C4 4개 프롬프트 완전 격리 |
| ④ **재현성·결정성·정형 로깅** (DV 측정 + peer review) | ❌ temp/seed/모델버전 고정 불가, 정형 로깅 없음 | ✅ `temperature:0`, 모델버전 고정, Mongo 정형 로깅 |

**핵심 한 줄:** ChatGPT 그룹챗이 아무리 "자연스러워" 보여도, 그 위에서는 **독립변수를 조작할 수도, 종속변수를 측정할 수도 없다.** 자연스러움은 수단이지 측정 대상이 아니며, 자연스러움 문제는 플랫폼 교체가 아니라 **Report 2의 품질 개선으로 해결**한다.

**버릴 것은 없다.** 지금 빌드된 시스템은 이 실험이 요구하는 통제·격리·로깅·재현성을 이미 정확히 구현하고 있다. 남은 단 하나의 문제(발화가 너무 김)는 통제 구조의 문제가 아니라 프롬프트·구조 튜닝의 문제다.

---

## 1. 이 결정을 보는 올바른 프레임

업로드한 분석문서는 "시간/비용/안정성/권위성/재현성" 5기준으로 비교했고, 결론(API로 가라)은 옳다. 다만 이 5기준을 **동등하게** 늘어놓으면 오해가 생긴다. 실제로는 두 종류의 기준이 섞여 있다:

- **편의 기준 (trade-off, 우열만 가림):** 시간/에너지, 비용 → ChatGPT가 유리해 보이지만, 아래에서 보듯 *이미 빌드가 끝난 상황*이라 이 우위는 환상이다.
- **게이트 기준 (pass/fail, 못 넘으면 실험 무효):** 실험 통제, 정보 격리, 재현성, 측정 → 하나라도 fail이면 나머지 기준의 점수는 의미가 없다.

> **즉, 이 결정은 가중 점수 합산이 아니라 게이트 통과 여부로 내려야 한다.** ChatGPT 그룹챗은 게이트 기준에서 fail이므로, 편의 기준의 우위와 무관하게 탈락이다.

---

## 2. 실험이 요구하는 것 ↔ ChatGPT 그룹챗이 실제로 제공하는 것

아래는 너의 **실험설계서 조항**과 **현재 코드가 그걸 어떻게 구현하는지**를, ChatGPT 그룹챗의 **2025-11 공식 사양**과 정면 대비한 것이다.

### 2.1 [치명적] 개입 타이밍 상수 통제 — 설계서 §4.3

- **설계서 요구:** "The AI's intervention timing is held constant across all four experimental conditions. Conditions differ only in *how* the AI responds, not in *when* it intervenes." → 타이밍은 IV가 아니라 **통제변수**. 4조건에서 똑같아야 한다.
- **현재 코드가 하는 일:** `server/src/triggers/`의 규칙으로 "언제"를 코드가 결정한다 — `MessageCountTrigger`(사람 메시지 5개마다), `TimeIntervalTrigger`(마지막 AI 발화 후 90초), `LongSilenceTrigger`(30초 정적). 4조건 모두 동일 규칙 → 타이밍이 상수로 고정됨.
- **ChatGPT 그룹챗의 실제:** ChatGPT가 "대화 흐름을 보고 스스로 답할 타이밍을 판단"한다(자동 응답 모드). 끄면 **사람이 수동으로 @ChatGPT를 쳐야만** 반응한다. → **코드로 "정확히 N번째 턴/특정 시각에 개입"을 강제할 수 없다.** 자동 모드는 조건·내용에 따라 개입 시점이 달라지고, 수동 모드는 사람이 호출 시점을 흔든다.
- **결과:** 타이밍이 조건 간 들쭉날쭉해지면, "어떻게(XAI/ACI, Leader/Peer)"의 효과와 "언제"의 효과가 **교란(confound)**된다. §4.3 통제가 무너진다.

### 2.2 [치명적] 정보 비대칭/격리 — 설계서 §4.4 (독립변수의 심장)

- **설계서 요구:** "AI holds only Z-profile information. The AI does not have access to X-profile or Y-profile information held by the two human team members." Hidden Profile 과제 자체가 **정보 비대칭** 위에 성립한다.
- **현재 코드가 하는 일:** `compiled-prompts.json`이 AI에게 **Profile Z만** 주입한다(C3 프롬프트의 "Your Information Set (Profile Z)" 블록). 사람의 X·Y는 서버가 클라이언트에만 따로 내려주고 AI 프롬프트엔 들어가지 않는다. AI는 채팅에 *올라온* 정보만 추가로 보게 되어, 실제 사람-AI 팀의 정보 풀링을 그대로 모사한다.
- **ChatGPT 그룹챗의 실제:** ChatGPT는 **방의 공유 대화 전체**를 본다. AI에게만 주고 사람에겐 숨기는 "비공개 지식"을 넣을 자리가 없다 — 그룹 지침에 Z를 적으면 **모든 참가자가 그 지침을 보거나 접근**할 수 있고, 채팅에 적으면 AI뿐 아니라 사람도 본다. 게다가 사람이 X·Y를 채팅에 입력하는 순간 AI가 **같은 맥락에서 즉시 흡수**한다.
- **결과:** Z-only 격리가 불가능 → Hidden Profile의 정보 비대칭이 처음부터 깨진다. 이건 단순 불편이 아니라 **IV 조작 자체가 불가능**해지는 것이다.

### 2.3 [치명적] 조건별/참가자별 시스템 프롬프트 — 2×2 조작의 전제

- **설계서 요구:** 2(Status: Leader/Peer) × 2(Strategy: XAI/ACI) = 4조건. 각 조건은 **서로 다른 AI 행동 사양**으로 정의된다(설계서 §4.1–4.2, 그리고 PMS가 생성한 `core_prompts/*.yaml` 4종).
- **현재 코드가 하는 일:** `buildSystemPrompt(conditionCode)`가 C1–C4에 대해 **완전히 다른 프롬프트**를 로드한다. PMS 파이프라인(Scout→Grounder→Architect→Critic→Supervisor)이 각 조건을 인용 근거와 manipulation-check 시뮬레이션으로 검증해 만든 독립 자산이다.
- **ChatGPT 그룹챗의 실제:** "그룹 커스텀 지침"은 **방 전체에 1세트**만 적용된다(개인 지침과도 분리). → Leader+XAI, Peer+ACI 등 4조건을 한 AI 인스턴스에 **격리해서 번갈아 주입할 방법이 없다.** 커스텀 GPT를 @로 불러와도 그들은 *같은 전체 맥락*을 공유하므로 격리가 안 된다.
- **결과:** Status·Strategy 조작을 구현할 수 없다 → 2×2 설계 자체가 성립하지 않는다.

### 2.4 [치명적] 재현성·결정성·정형 로깅 — DV 측정 + 논문 심사

- **설계서 요구:** DV로 Information Pooling Rate, Shared Information Bias(chat log coding), Decision Accuracy, Trust 등을 **정량 측정**하고, Manipulation check·민감도 분석을 한다. 이 모든 게 **신뢰할 수 있는 정형 데이터**와 **재현 가능한 자극 생성**을 전제한다.
- **현재 코드가 하는 일:** `callAIStructured`가 `temperature:0`로 결정성을 확보하고 모델버전을 코드에 고정한다. 모든 메시지·AI 개입이 `Message`/`AIIntervention` 컬렉션에 **seq·timestamp·token·latency·responseId까지 정형 저장**된다 → chat log coding과 pooling 분석의 1차 데이터가 그대로 나온다.
- **ChatGPT 그룹챗의 실제:** 사용자 단에서 `temperature`/`seed`/모델버전을 고정할 수 없고, OpenAI가 모델을 계속 업데이트한다(오늘과 한 달 뒤 결과가 다를 수 있음). 데이터는 수동 복사/단순 내보내기뿐 — pooling rate·bias 코딩용 정형 로그가 없다.
- **결과:** DV의 측정 근거가 불안정하고, peer review에서 "무작위성·정렬정책으로 인한 조작 실패 가능성"을 지적당한다. (업로드 문서의 §5–§7 지적이 여기서 정확하다.)

---

## 3. 업로드 분석문서 교차검증 (사실 확인)

업로드한 `chatgpt_vs_api_experiment_analysis.md`의 주요 주장을 2025-11 공식 사실과 대조했다. **핵심 결론과 논거는 모두 정확**하다. 보정·보강할 점만 정리한다.

**정확히 확인된 주장**
- ChatGPT는 자동 응답 모드 또는 @멘션 전용 모드로만 작동하며 타이밍을 코드로 강제할 수 없다. ✅
- 그룹 지침은 방 전체 공유이며 참가자별 개별 프롬프트 주입이 불가능하다. ✅
- 채팅에 올라온 정보를 AI가 실시간 흡수해 정보 격리가 깨진다. ✅
- API는 temperature=0·모델버전 고정·seed로 재현성을 확보할 수 있다. ✅

**보정/추가 사실 (2025-11 기준)**
- **참가자 한도:** 그룹챗은 **최대 20명** + ChatGPT. (실험은 팀당 2–3명이라 한도는 무관.)
- **요금/가용성:** Free·Go·Plus·Pro 전 플랜에 글로벌 확대됨. (즉 "구독료 우위"라는 비용 논거의 무게도 약하다 — API 비용도 25팀 규모면 학술 예산 내.)
- **프라이버시:** 개인 메모리·개인 커스텀 지침은 그룹챗에 공유되지 않는다. 프라이버시엔 좋지만 **실험 통제와는 무관** (오히려 "AI에게만 줄 비공개 지식" 주입을 더 어렵게 만든다).

**업로드 문서가 약하게 다룬 지점 (이 리포트가 보강)**
- 문서는 ChatGPT 그룹챗을 "버리고 갈아탈 후보"로 취급하지만, 정확히는 **"측정·통제 불가라 애초에 후보가 안 됨"**이다. 비교의 결론이 "A가 B보다 낫다"가 아니라 **"B는 이 실험의 출전 자격이 없다"**라는 점을 분명히 해야 한다.
- 문서는 ChatGPT 그룹챗의 **유일한 정당한 쓸모**(아래 §4)를 언급하지 않는다.

---

## 4. 그래도 ChatGPT 그룹챗이 주는 진짜 가치 (steelman)

후보 자격이 없다는 것과 쓸모가 전혀 없다는 것은 다르다. 큰 결정을 앞둔 만큼, **반대편을 가장 강하게 세워** 본 결과 — 실험 플랫폼이 아닌 **보조 도구**로서는 두 가지 실질 가치가 있다:

1. **자연스러운 다자 턴테이킹의 레퍼런스.** OpenAI가 그룹챗에서 "AI가 매 메시지에 답하지 않고, 흐름을 보고 끼어든다 / 간결하게 답한다"를 어떻게 튜닝했는지 직접 관찰하면, 너의 **발화-이유 판정(Report 2의 레버 A·D) 설계**에 좋은 직관을 준다. 즉 "사람 같은 AI 참여"가 어떤 모양인지 무료로 벤치마킹할 수 있다.
2. **비공식 내부 파일럿(실험 아님).** 연구진끼리 그룹챗 방을 열어 "Alex 같은 AI가 토론에 끼면 어떤 느낌인지"를 30분 만에 체감 → 프롬프트 목표(간결·한 포인트·추천 강요 금지)를 구체화하는 데 도움.

> 단, **둘 다 측정·통제 플랫폼으로 쓰는 게 아니다.** 영감과 감(感) 잡기 용도이며, 실제 데이터는 100% API 시스템에서 나와야 한다.

---

## 5. "개발 시간·비용 우위"는 지금 상황에서 환상이다

업로드 문서의 5기준 중 ChatGPT가 이긴 두 칸(시간/비용)은 **"아직 아무것도 안 만든 상태"를 가정**한다. 너의 실제 상황은 다르다:

- 너는 이미 **2인+AI 동기화 룸, 세션/참가자 코드 발급, 트리거 기반 개입, 정형 로깅, PMS 프롬프트 동결·검증**까지 갖춘 풀스택을 빌드했다. "개발 안 해도 됨"의 절약분은 이미 소진되어 환상이다.
- 오히려 ChatGPT 그룹챗으로 가면 **통제·격리·로깅을 처음부터 다시** 만들어야 하는데, §2에서 봤듯 그건 **만들 수가 없다**. 즉 "시간 절약"이 아니라 "지금 가진 자산을 버리고도 목표에 도달 못 함"이다.
- 비용도 25팀 규모면 API 토큰 비용은 학술 예산 내(수백 달러 수준)이고, Report 2의 오프라인 eval로 **라이브 피험자 없이 프롬프트를 싸게 반복**할 수 있어 오히려 비용 효율적이다.

---

## 6. 결정 요약 표

| 기준 | 종류 | ChatGPT 그룹챗 | 현재 API 시스템 | 판정 |
|---|---|---|---|---|
| 개입 타이밍 상수 통제 (§4.3) | 게이트 | ❌ 불가 | ✅ `triggers/*.ts` | API |
| 정보 격리 Z-only (§4.4) | 게이트 | ❌ 불가 (오염) | ✅ 서버 통제 | API |
| 조건별 시스템 프롬프트 (2×2) | 게이트 | ❌ 방 전체 1세트 | ✅ C1–C4 격리 | API |
| 재현성·결정성 | 게이트 | ❌ 고정 불가 | ✅ temp0+버전고정 | API |
| 정형 데이터 로깅 (DV) | 게이트 | ❌ 수동 export | ✅ Mongo 정형 | API |
| 개발 시간 | 편의 | 🟡 (이미 빌드 끝나 무의미) | 🟢 빌드 완료 | API |
| 비용 | 편의 | 🟡 구독료 | 🟢 토큰(예산 내)+오프라인 eval | API |
| 발화 자연스러움(현재) | 품질 | 🟢 튜닝됨 | 🟡 개선 필요 → **Report 2** | (둘 다 해결가능) |

게이트 기준 5개 전부에서 ChatGPT 그룹챗이 fail이다. 결정은 명확하다.

---

## 7. 최종 권고

1. **플랫폼은 현재 API 시스템(Socket.IO + Express + Mongo + PMS)으로 확정한다.** ChatGPT 그룹챗은 이 통제 실험의 출전 자격이 없다(IV 조작·DV 측정 불가).
2. **ChatGPT 그룹챗은 "자연스러움 레퍼런스 + 비공식 파일럿"으로만** 가볍게 활용한다(선택). 데이터는 거기서 뽑지 않는다.
3. **유일하게 남은 문제(발화가 너무 김, 사람 같지 않음)는 플랫폼이 아니라 프롬프트·구조의 문제**다 → **Report 2**의 구체 플랜으로 해결한다. 핵심 원인은 이미 코드에서 특정됐다: (a) 이미 작성됐지만 런타임에 배선되지 않은 *발화-이유 라우팅*, (b) 출력 토큰 하드캡 부재, (c) 동결 프롬프트 내부의 간결성↔철저함 모순.

> 한 문장 요약: **"버릴 시스템은 없다. 갈아탈 게 아니라, 이미 옳게 만든 시스템의 발화 품질만 다듬으면 된다."**

---

### 출처 (ChatGPT 그룹챗 공식 사실)
- [Introducing group chats in ChatGPT | OpenAI](https://openai.com/index/group-chats-in-chatgpt/)
- [Group Chats in ChatGPT | OpenAI Help Center](https://help.openai.com/en/articles/12703475-group-chats-in-chatgpt)
- [ChatGPT Group Chats are here … but not for everyone (yet) | VentureBeat](https://venturebeat.com/ai/chatgpt-group-chats-are-here-but-not-for-everyone-yet)
- [OpenAI brings multi-user ChatGPT conversations to everyone | Technology.org](https://www.technology.org/2025/11/21/openai-brings-multi-user-chatgpt-conversations-to-everyone/)

### 근거가 된 코드/설계 (HAIT 리포지토리)
- `server/src/triggers/{MessageCount,TimeInterval,LongSilence}Trigger.ts`, `server/src/config/triggers.ts` — 타이밍 통제
- `server/src/lib/prompts.ts`, `server/src/lib/compiled-prompts.json` — 조건별 격리 프롬프트, Z-profile 주입
- `server/src/lib/openai.ts` — `temperature:0`, 모델버전 고정, 구조화 출력
- `server/src/models/{Message,AIIntervention}.ts` — 정형 로깅
- 실험설계서 §4.1–4.4, §5–§6, §8 — 통제·격리·측정 요구사항
