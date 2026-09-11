# CLAUDE.md

## Rule

- **설명은 일상어로.** 코드 이름(함수·파일·필드·상수)을 문장의 주어로 쓰지 않는다. 그것이 *하는 일*을 쓴다. "outputScopeViolation이 걸렸다"가 아니라 "내보내기 전 검사기가 걸렀다". 코드 이름은 근거 링크로만 문장 끝에 붙인다.
- **도메인 용어는 예외.** CONTEXT.md에 정의된 말(board, opportunity, reveal budget, Chair/Member 등)은 풀어쓰지 말고 그대로 쓴다. 쉽게 쓰라는 건 구현 용어에 대한 것이지 도메인 용어에 대한 게 아니다. 새 용어는 첫 등장에 한 줄로 정의하고, 그 뒤로는 그 말만 쓴다.
- **추상 설명보다 실제 사건.** 무슨 일이 벌어지는지 설명할 때 그게 실제로 일어난 세션과 seq를 들어 설명한다. 없으면 없다고 말한다.
- **표는 사건을 나열할 때만.** "누가 무엇을 정했나" 같은 표는 좋고, 필드 목록을 표로 옮기는 건 안 된다.
- 답은 결론부터. 서론·복기·다시 한 말 없이.
- **선택지를 줄 때는 추천 하나와 그 근거를 붙인다.** 나열만 하지 않는다.
- 목표를 이루기 위한 근본 원인을 해결해야하며, 엣지 케이스마다 대응하여 메우는 건 사전 합의가 필요함. 합리적인 근거와 함께 논의되어야 함. 목표가 확실치 않다면 목표를 정해야함.
- ARCHITECTURE.md 를 항상 확인하고 전체 코드 안에서의 의존성을 읽으며 코드를 수정해야하며, 수정된 후엔 이 파일을 갱신한다.

## 프로젝트 구조

- client/ — React + Vite + Tailwind (Lovable 생성, TypeScript)
- server/ — Express + TypeScript (tsx watch로 개발)

## 경로 기준

- 모든 상대 경로는 client/ 또는 server/ 기준
- npm install은 각각 따로 (workspaces 미사용)

## 실행

- cd client && npm run dev → localhost:8080
- cd server && npm run dev → localhost:3001

## 환경변수

- server/.env (server/.env.example 참고)
- OPENAI_API_KEY, MONGODB_URI, PORT

## Agent skills

### Issue tracker

이슈는 이 레포 안의 `.scratch/<feature-slug>/` 마크다운 파일로 관리합니다 (GitHub Issues 미사용). See `docs/agents/issue-tracker.md`.

### Triage labels

정규 triage 역할 다섯 개를 이름 그대로 씁니다: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

single-context — 루트에 `CONTEXT.md` 하나와 `docs/adr/` 하나. See `docs/agents/domain.md`.
