# CLAUDE.md

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
