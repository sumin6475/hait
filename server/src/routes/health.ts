//헬스 체크
import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});