import express from 'express';
import cors from 'cors';
import { assertConfig, config } from './config.js';

assertConfig();

const { default: retellRoutes } = await import('./routes/retell.js');
const { default: callRoutes } = await import('./routes/calls.js');
const { default: maintenanceRoutes } = await import('./routes/maintenance.js');
const { default: predictRoutes } = await import('./routes/predict.js');
const { default: clusterRoutes } = await import('./routes/clusters.js');
const { startRetellSync } = await import('./retellSync.js');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/retell', retellRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/predict-degradation', predictRoutes);
app.use('/api/clusters', clusterRoutes);

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Civic call center API listening on http://localhost:${config.port}`);
  startRetellSync();
});
