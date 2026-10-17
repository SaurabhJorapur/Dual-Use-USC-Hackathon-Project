// Groups existing calls into incident clusters (run once after migration 04, or to rebuild).
// Usage: npm run backfill:clusters
import { assertConfig } from '../src/config.js';

assertConfig();
const { backfillClusters, listClusters } = await import('../src/clustering.js');

const count = await backfillClusters();
const clusters = await listClusters({ since: '1970-01-01' });
console.log(`Processed ${count} calls into ${clusters.length} cluster(s).`);
for (const c of clusters) console.log(`  ${c.report_count} reports · ${c.category} · ${c.location_label || 'unknown location'} · ${c.status}`);
