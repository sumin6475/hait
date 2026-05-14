//환경변수 로드 + 검증
import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string) : string {
  const value = process.env[name];
  if(!value || value.trim() === ''){
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Check your server/.env file. See server/.env.example for the required keys.` 
    );
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  mongodbUri: requireEnv('MONGODB_URI'),
  openaiApiKey: requireEnv('OPENAI_API_KEY'),
};