import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Reads server/.env first, then the repo-root .env (shared with the client), from any cwd.
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const rootDir = fileURLToPath(new URL('../..', import.meta.url));
dotenv.config({ path: [`${serverDir}.env`, `${rootDir}.env`], quiet: true });

export const config = {
  port: Number(process.env.PORT) || 3001,
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  retellApiKey: process.env.RETELL_API_KEY,
  retellAgentId: process.env.RETELL_AGENT_ID,
  verifyWebhooks: process.env.RETELL_VERIFY_WEBHOOKS !== 'false',
  // Poll Retell for calls instead of (or as well as) receiving webhooks. Set by setup:retell.
  retellSync: process.env.RETELL_SYNC === 'true',
};

export function assertConfig() {
  const missing = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')} (see .env.example)`);
  }
  if (!config.retellApiKey) {
    console.warn('[config] RETELL_API_KEY not set: webhook verification and web calls are disabled.');
  }
}
