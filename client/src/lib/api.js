const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  listCalls: () => request('/api/calls?limit=500'),
  updateStatus: (id, status) => request(`/api/calls/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  createWebCall: () => request('/api/retell/web-call', { method: 'POST' }),
};
