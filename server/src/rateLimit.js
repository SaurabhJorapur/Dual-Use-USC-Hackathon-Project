// Small in-memory sliding-window rate limiter keyed by client IP, for the public report
// endpoint. Per process only; put a shared limiter in front if the API runs on several
// instances. Limits are generous because people behind one carrier NAT share an IP.
export function rateLimit({ windowMs, max, message = 'Too many requests', now = Date.now }) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const recent = (hits.get(key) || []).filter((at) => at > t - windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      res.set('Retry-After', String(Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000))));
      return res.status(429).json({ error: message });
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (times[times.length - 1] <= t - windowMs) hits.delete(k);
    }
    next();
  };
}
