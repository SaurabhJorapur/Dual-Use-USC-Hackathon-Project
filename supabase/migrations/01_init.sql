-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Calls Table
CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    retell_call_id VARCHAR(255) UNIQUE NOT NULL,
    caller_phone VARCHAR(50) NOT NULL,
    category VARCHAR(50) CHECK (category IN ('Public Safety', 'Potholes', 'Traffic Signals', 'Noise & Other')) NOT NULL,
    urgency_level VARCHAR(20) CHECK (urgency_level IN ('Critical', 'Urgent', 'Standard')) NOT NULL,
    status VARCHAR(50) CHECK (status IN ('Escalated to 911', 'Escalated to Human', 'AI Completed', 'In Progress')) NOT NULL,
    summary TEXT NOT NULL,
    location VARCHAR(255),
    caller_name VARCHAR(100),
    audio_url TEXT,
    transcript TEXT,
    escalation_timeline JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX calls_created_at_idx ON calls (created_at DESC);
CREATE INDEX calls_urgency_idx ON calls (urgency_level);

-- Row Level Security: the dashboard (anon key) can read; only the backend
-- (service role key, which bypasses RLS) can write.
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dashboard can read calls" ON calls FOR SELECT USING (true);

-- Send full rows on UPDATE/DELETE so realtime clients get complete payloads
ALTER TABLE calls REPLICA IDENTITY FULL;

-- Realtime publication for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE calls;
