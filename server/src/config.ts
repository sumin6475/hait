//환경변수 로드 + 검증
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3001,
  mongodbUri: process.env.MONGODB_URI || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
};