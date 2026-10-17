// Runs the trained streetlight degradation model (scripts/train_model.py) through a
// long-lived Python worker (scripts/predict_worker.py): spawned on first use, it loads the
// model once and answers one JSON line per request, so predictions take milliseconds.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const MODEL_FILE = `${SERVER_DIR}models/degradation_model.joblib`;
const RISK_MAP_FILE = `${SERVER_DIR}data/aggregated_risk_map.json`;
const WORKER = `${SERVER_DIR}scripts/predict_worker.py`;
const VENV_PYTHON = `${SERVER_DIR}.venv/bin/python`;
const TIMEOUT_MS = 15000;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Validates the POST body; returns the normalized request or throws a 400. */
export function parsePredictInput(body = {}) {
  const zipcode = body.zipcode == null || body.zipcode === '' ? null : String(body.zipcode).trim();
  if (zipcode && !/^\d{5}$/.test(zipcode)) throw httpError(400, 'zipcode must be 5 digits');

  const hasLat = body.latitude != null && body.latitude !== '';
  const hasLng = body.longitude != null && body.longitude !== '';
  if (hasLat !== hasLng) throw httpError(400, 'latitude and longitude must be given together');
  const latitude = hasLat ? Number(body.latitude) : null;
  const longitude = hasLng ? Number(body.longitude) : null;
  if (hasLat && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) throw httpError(400, 'latitude is invalid');
  if (hasLng && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw httpError(400, 'longitude is invalid');
  if (!zipcode && !hasLat) throw httpError(400, 'Provide a zipcode or latitude/longitude');

  const days = Number(body.days_since_repair);
  if (body.days_since_repair == null || body.days_since_repair === '' || !Number.isFinite(days) || days < 0 || days > 36500) {
    throw httpError(400, 'days_since_repair must be a number of days (0 or more)');
  }
  return { zipcode, latitude, longitude, days_since_repair: days };
}

let worker = null;
let nextId = 1;
const pending = new Map();

function failAll(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(httpError(503, message));
  }
  pending.clear();
}

function startWorker() {
  const python = process.env.PYTHON_BIN || (existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3');
  const child = spawn(python, [WORKER], { cwd: SERVER_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return console.warn('[degradation] unexpected worker output:', line.slice(0, 200));
    }
    const job = pending.get(msg.id);
    if (!job) return;
    pending.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.error) job.reject(httpError(500, `Prediction failed: ${msg.error}`));
    else job.resolve(msg.result);
  });
  const onExit = (reason) => {
    if (worker === child) worker = null;
    console.error(`[degradation] worker stopped (${reason})${stderr ? `:\n${stderr.trim()}` : ''}`);
    failAll('The prediction worker stopped; check the server log (is the Python venv set up?)');
  };
  child.on('error', (err) => onExit(err.message));
  child.on('exit', (code, signal) => onExit(signal || `exit ${code}`));
  return child;
}

/** Scores a request validated by parsePredictInput. */
export function predictDegradation(input) {
  if (!existsSync(MODEL_FILE)) {
    return Promise.reject(httpError(503, 'Model not trained yet: run `npm run train:model` in server/'));
  }
  worker ||= startWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(httpError(504, 'Prediction timed out'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    worker.stdin.write(`${JSON.stringify({ id, ...input })}\n`);
  });
}

let riskMap = { mtimeMs: 0, data: null };

/** The training script's precomputed hotspots, re-read when the file changes. */
export function getRiskMap() {
  if (!existsSync(RISK_MAP_FILE)) throw httpError(404, 'No risk map yet: run `npm run train:model` in server/');
  const { mtimeMs } = statSync(RISK_MAP_FILE);
  if (mtimeMs !== riskMap.mtimeMs) riskMap = { mtimeMs, data: JSON.parse(readFileSync(RISK_MAP_FILE, 'utf8')) };
  return riskMap.data;
}
