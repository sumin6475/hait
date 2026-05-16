import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../sockets/events.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

// clinet 에선 타입 순서가 반대
// - client listen : ServenToClientEvents
// - client emit : ClientToServerEvents

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false, // 명시적 연결 필요
});
