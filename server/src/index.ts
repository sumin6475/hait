import express from "express";
import cors from "cors";
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
  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
