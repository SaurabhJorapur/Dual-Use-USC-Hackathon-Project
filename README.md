# CivicLine: Dual-Use Civic AI Call Center

A single phone line, answered by a Retell AI voice agent, that triages **city service reports** (potholes,
traffic signals, noise) versus **emergencies** (robberies, accidents) and streams every call to a real-time
municipal dashboard.

```
Caller ──► Retell AI agent ──webhooks/functions──► Express API ──► Supabase (Postgres)
                                                                      │ Realtime
                                              React dashboard ◄───────┘
```

## Stack

- **client/**: React (Vite) + Tailwind CSS + Lucide icons, with Supabase Realtime for live updates
- **server/**: Node.js + Express, which handles Retell webhooks, custom functions, and the dashboard REST API
- **supabase/migrations/01_init.sql**: `calls` table, RLS (read-only for the anon key), realtime publication
- **docs/retell-agent-setup.md**: agent prompt, functions, and post-call analysis config

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/01_init.sql` in the SQL editor (or `supabase db push` with the CLI).

### 2. Environment
One `.env` in the repo root is shared by the server and the dashboard:
```bash
cp .env.example .env     # fill in Supabase + Retell keys
```
Only `VITE_`-prefixed values are exposed to the browser.

### 3. Server
```bash
cd server
npm install
npm run seed             # optional: demo calls (npm run seed -- --clear to remove)
npm run dev              # http://localhost:3001
```

### 4. Dashboard
```bash
cd client
npm install
npm run dev              # http://localhost:5173 (realtime needs VITE_SUPABASE_*; otherwise polls every 5s)
```

### 5. Retell
Expose the API publicly, then let the setup script configure the agent:
```bash
cloudflared tunnel --url http://localhost:3001     # or ngrok http 3001; copy the https URL
cd server && npm run setup:retell -- https://YOUR-TUNNEL-URL
```
The script creates (or updates) a Single Prompt agent with the prompt, functions, webhook and post-call
analysis, publishes it, and saves `RETELL_AGENT_ID` to `.env`. Restart the server afterwards. **Rerun it
whenever the tunnel URL changes.** The **Test call** button then starts a browser call to the agent.
[docs/retell-agent-setup.md](docs/retell-agent-setup.md) documents what it configures.

**No public URL yet?** Run `npm run setup:retell` with no argument. The agent gets no webhook or mid-call
functions, and the server polls Retell for calls every 5s instead (`RETELL_SYNC=true`). Calls still reach the
dashboard with transcripts and triage, but escalations only happen after the call ends. Rerun with a URL later
to enable live escalations.

## How triage works

| Urgency | Meaning | Status |
|---|---|---|
| Critical | Threat to life/safety | Escalated to 911 |
| Urgent | Immediate hazard | Escalated to Human |
| Standard | Routine service request | AI Completed |

1. **During the call:** the agent calls `escalate_emergency` / `request_human` / `log_service_request`, and the
   dashboard updates live. These escalations act as a floor that later automated triage can't lower.
2. **`call_ended`:** the transcript and recording are saved, and provisional keyword triage runs.
3. **`call_analyzed`:** Retell's post-call analysis sets the final category, urgency and summary. A keyword
   safety net forces **Critical** if the transcript mentions weapons, injuries, fire, crashes, etc.

Dispatchers can override any call's status from the detail drawer.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/webhooks/retell` | Retell call events (signature verified) |
| POST | `/api/retell/functions/:name` | Agent custom functions (signature verified) |
| POST | `/api/retell/web-call` | Mint a browser test-call access token |
| GET | `/api/calls` | List calls (`category`, `urgency`, `status`, `search`, `limit`) |
| GET | `/api/calls/stats` | Aggregate counts |
| GET | `/api/calls/:id` | One call |
| PATCH | `/api/calls/:id/status` | Dispatcher status override `{ status, note? }` |

## Tests
```bash
cd server && npm test    # triage classifier
```

## Before production
- **Add authentication** to the dashboard and the `/api/calls` + `/api/retell/web-call` routes (e.g. Supabase
  Auth). They are open in this build, and the anon key can read all calls under the current RLS policy.
- Never route demo transfers to real 911. Configure a test number.
- Call recordings and transcripts may contain personal data, so set a retention policy.
