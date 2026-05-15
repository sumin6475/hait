import { io, type Socket } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false, // 명시적 연결 필요
});
