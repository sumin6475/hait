import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { connectDB } from "./db.js";
import { healthRouter } from "./routes/health.js";
import { testRouter } from "./routes/test.js";
import { sessionsRouter } from "./routes/sessions.js";
import { registerSocketHandlers } from "./sockets/index.js";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./sockets/events.js";

// CORS — CORS_ORIGIN(콤마 구분). 미설정 시 전체 허용(로컬 개발용)
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
  : true;

const corsOptions: cors.CorsOptions = {
  origin: corsOrigins,
  credentials: true,
  allowedHeaders: ["Content-Type", "x-admin-token"],
};

async function start() {
  await connectDB();
  const app = express();

  app.use(cors(corsOptions));
  app.use(express.json());
  app.use(healthRouter);
  app.use(testRouter);
  app.use(sessionsRouter);

  // HTTP 서버 생성 - Socket.io 부착 위해
  const httpServer = http.createServer(app);
  // Socket.io 서버 생성
  const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
  });
  // Socket.io 연결 이벤트 핸들러
  registerSocketHandlers(io);

  // httpServer로 listen (app.listen 아님))
  httpServer.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
