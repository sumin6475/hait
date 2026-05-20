//Admin 인증 미들웨어
//x-admin-token 헤더가 ADMIN_TOKEN과 일치해야 통과
//실패 시 401

import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-admin-token");
  if (!token || token !== config.adminToken) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}
