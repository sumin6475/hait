//서버 진입점
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(healthRouter);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});