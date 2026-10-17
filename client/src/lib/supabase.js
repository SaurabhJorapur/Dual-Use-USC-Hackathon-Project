import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when not configured; the dashboard then polls the API instead of using realtime.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
