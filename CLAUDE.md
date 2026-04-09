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
