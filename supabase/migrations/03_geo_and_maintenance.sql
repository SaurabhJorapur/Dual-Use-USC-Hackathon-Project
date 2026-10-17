-- Map coordinates for calls (geocoded server-side from the free-text location)
-- and a table for preemptive maintenance crews dispatched from the dashboard.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS maintenance_dispatches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    location VARCHAR(255) NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    probability INTEGER NOT NULL CHECK (probability BETWEEN 0 AND 100),
    inputs JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'Dispatched'
);

CREATE INDEX IF NOT EXISTS maintenance_created_at_idx ON maintenance_dispatches (created_at DESC);

ALTER TABLE maintenance_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Dashboard can read maintenance" ON maintenance_dispatches;
CREATE POLICY "Dashboard can read maintenance" ON maintenance_dispatches FOR SELECT USING (true);
ALTER TABLE maintenance_dispatches REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE maintenance_dispatches;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
