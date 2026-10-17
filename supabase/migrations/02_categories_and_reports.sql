-- Five-category model + formal incident reports.
-- Remaps existing rows to the new categories before enforcing the new constraint.

BEGIN;

ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_category_check;

UPDATE calls SET category = CASE
    WHEN category = 'Public Safety' AND urgency_level = 'Critical' THEN 'Emergency / Active Danger'
    WHEN category = 'Public Safety' THEN 'Public Safety & Hazards'
    WHEN category IN ('Potholes', 'Traffic Signals') THEN 'Roads & Infrastructure'
    WHEN category = 'Noise & Other' AND summary ~* '(water|sewer|power|outage|tree)' THEN 'Utilities & Water'
    WHEN category = 'Noise & Other' AND summary ~* '(streetlight|street light|sign|sidewalk)' THEN 'Roads & Infrastructure'
    WHEN category = 'Noise & Other' THEN 'Code Enforcement & Sanitation'
    ELSE category
END;

ALTER TABLE calls ADD CONSTRAINT calls_category_check CHECK (category IN (
    'Emergency / Active Danger',
    'Public Safety & Hazards',
    'Roads & Infrastructure',
    'Utilities & Water',
    'Code Enforcement & Sanitation'
));

-- Sequential number behind the human-facing incident ID (INC-<year>-<number>).
-- BIGSERIAL fills existing rows automatically.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS incident_number BIGSERIAL UNIQUE;

-- Structured report assembled by the server from Retell's post-call analysis.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS formal_report JSONB;

COMMIT;
