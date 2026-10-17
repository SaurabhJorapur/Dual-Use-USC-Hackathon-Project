import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node < 22 has no native WebSocket; supabase-js refuses to start without one.
  realtime: { transport: ws },
});
