-- Incident clustering: matching calls (same category, ~150 m, < 1 h apart) grouped into
-- incidents for the Clusters page. Stored separately; the calls table is unchanged.
CREATE TABLE IF NOT EXISTS incident_clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    category VARCHAR(100) NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    location_label VARCHAR(255),
    report_count INTEGER NOT NULL DEFAULT 0,
    unique_callers INTEGER NOT NULL DEFAULT 0,
    first_report_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_report_at TIMESTAMP WITH TIME ZONE NOT NULL,
    max_urgency VARCHAR(20) NOT NULL DEFAULT 'Standard',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'escalated', 'resolved')),
    notes JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- A call belongs to at most one cluster.
CREATE TABLE IF NOT EXISTS incident_cluster_members (
    call_id UUID PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
    cluster_id UUID NOT NULL REFERENCES incident_clusters(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS incident_clusters_last_report_idx ON incident_clusters (last_report_at DESC);
CREATE INDEX IF NOT EXISTS incident_cluster_members_cluster_idx ON incident_cluster_members (cluster_id);

ALTER TABLE incident_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_cluster_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Dashboard can read clusters" ON incident_clusters;
CREATE POLICY "Dashboard can read clusters" ON incident_clusters FOR SELECT USING (true);
DROP POLICY IF EXISTS "Dashboard can read cluster members" ON incident_cluster_members;
CREATE POLICY "Dashboard can read cluster members" ON incident_cluster_members FOR SELECT USING (true);
ALTER TABLE incident_clusters REPLICA IDENTITY FULL;
ALTER TABLE incident_cluster_members REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE incident_clusters;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE incident_cluster_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
