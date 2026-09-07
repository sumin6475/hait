//환경변수 로드 + 검증
import dotenv from "dotenv";
dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Check your server/.env file. See server/.env.example for the required keys.`,
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  mongodbUri: requireEnv("MONGODB_URI"),
  openaiApiKey: requireEnv("OPENAI_API_KEY"),
  // U-M GPT Toolkit 게이트웨이 엔드포인트 (예: https://api.toolkit.umgpt.umich.edu/v1)
  openaiApiBase: requireEnv("OPENAI_API_BASE"),
  adminToken: requireEnv("ADMIN_TOKEN"),
  // Observer is part of the live controller by default. Shadow/off remain
  // explicit rollback modes for comparison and incident recovery.
  conversationObserverMode:
    process.env.CONVERSATION_OBSERVER_MODE === "off"
      ? ("off" as const)
      : process.env.CONVERSATION_OBSERVER_MODE === "shadow"
        ? ("shadow" as const)
        : process.env.CONVERSATION_OBSERVER_MODE === "active"
          ? ("active" as const)
          : ("active" as const),
  // The ledger controller consumes the Observer projection in the normal live
  // path. Legacy and ledger_shadow are explicit rollback/comparison modes.
  conversationControllerMode:
    process.env.CONVERSATION_CONTROLLER_MODE === "legacy"
      ? ("legacy" as const)
      : process.env.CONVERSATION_CONTROLLER_MODE === "ledger_shadow"
        ? ("ledger_shadow" as const)
        : process.env.CONVERSATION_CONTROLLER_MODE === "ledger_active"
          ? ("ledger_active" as const)
          : ("ledger_active" as const),
};
