import express from 'express';
import cors from 'cors';
import { assertConfig, config } from './config.js';

assertConfig();

const { default: webhookRoutes } = await import('./routes/webhooks.js');
const { default: retellRoutes } = await import('./routes/retell.js');
const { default: callRoutes } = await import('./routes/calls.js');
const { startRetellSync } = await import('./retellSync.js');

const app = express();

app.use(cors({ origin: config.corsOrigin }));
// Keep the raw body: Retell signatures are computed over the exact bytes sent.
app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }),
);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/webhooks', webhookRoutes);
app.use('/api/retell', retellRoutes);
app.use('/api/calls', callRoutes);

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`Civic call center API listening on http://localhost:${config.port}`);
  if (config.retellSync) startRetellSync();
});
