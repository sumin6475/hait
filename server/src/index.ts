import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { connectDB } from "./db.js";
import { healthRouter } from "./routes/health.js";
import { testRouter } from "./routes/test.js";

async function start() {
  await connectDB();
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(healthRouter);
  app.use(testRouter);

  // HTTP 서버 생성 - Socket.io 부착 위해
  const httpServer = http.createServer(app);
  // Socket.io 서버 생성
  const io = new Server(httpServer, {
    cors: {
      origin: "http://localhost:8080", //Vite origin
      credentials: true,
    },
  });
  // Socket.io 연결 이벤트 핸들러
  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);
    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected: ${socket.id} (${reason})`);
    });
  });

  // httpServer로 listen (app.listen 아님))
  httpServer.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
