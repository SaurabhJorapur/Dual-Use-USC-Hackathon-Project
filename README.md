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

- **client/**: React (Vite) + Tailwind CSS + Lucide icons, Leaflet maps, Recharts, and Supabase Realtime for live updates
- **server/**: Node.js + Express, which handles Retell webhooks, custom functions, and the dashboard REST API
- **supabase/migrations/01_init.sql**: `calls` table, RLS (read-only for the anon key), realtime publication
- **docs/retell-agent-setup.md**: agent prompt, functions, and post-call analysis config

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/01_init.sql`, `02_categories_and_reports.sql`, `03_geo_and_maintenance.sql` and
   `04_incident_clusters.sql`, in order, in the SQL editor (or `supabase db push` with the CLI). After 04, run
   `cd server && npm run backfill:clusters` once to group existing calls.

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
npm run seed             # optional: demo calls incl. map hotspots (npm run seed -- --clear to remove)
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

## Dashboard

A map-centric command center:

- **Left sidebar:** view tabs, 24h counters, the category distribution (click a category to filter the map and
  logs) and a 24-hour call surge chart, which flags a surge when the current hour exceeds 2x the hourly average.
- **Live City Map:** calls pinned by category color (red emergency, yellow hazards, blue roads/water/utilities,
  gray code enforcement), with a heat map toggle. Click a pin for a call card with transcript lines and a link to
  the full report. The **Predictive** toggle shows flames where the degradation model predicts an 80%+ chance of a
  streetlight failing again within 90 days (click one for the street, risk and repair history).
- **Call Logs & Records:** a searchable, filterable table. Click a row for the transcript and formal incident
  report. Calls in the same incident cluster are listed once, as a single **Cluster** entry with the number of
  calls; click it for every call in the cluster.
- **Bottom ticker:** the latest calls. Click one to open it.
- **Incident Clusters** (separate page, also at `#/clusters`): see below.
- **Disaster Twin Simulator 🔮** (full-screen page, also at `#/simulation`): replays pre-built crisis scenarios
  (normal operations, an M6.8 earthquake at 2 AM, an atmospheric-river flash flood) with an alert banner, an AI
  resource recommendation, a call-surge curve against the normal baseline, category load and a dark map of simulated
  incidents. Scenarios are static data in `client/src/data/simulationScenarios.js`, so switching is instant and every
  demo is identical.

**Map pins** come from the caller's spoken location, geocoded on the server (`server/src/geocode.js`). It tries
the US Census geocoder (addresses and intersections), then Photon and Nominatim (OpenStreetMap), limited to the
LA area, cached and rate limited to 1/s. Calls without a usable location are counted in a chip on the map. The
basemap is Esri Light Gray Canvas (no API key needed).

## Predictive degradation model

A gradient-boosted classifier trained on 2020-2025 MyLA311 **streetlight** requests (the only repaired-asset type in
the data; there are no pothole records). Question it answers: *will this location get another streetlight
complaint within 90 days?*

- **Location** = a ~100 m cell (lat/lng rounded to 3 decimals). **Features**: days since the last completed repair,
  complaints in the last 2 years and in the last year, average days to close requests there (falling back to the
  ZIP, then citywide), and whether the last repair was a single- or multi-light issue.
- **Training rows** are quarterly snapshots, with features from before the snapshot and the outcome from the 90 days
  after. The holdout is the last four quarters, so the metrics measure forecasting, not memorization: **AUC 0.70**;
  the HIGH tier (top 10%) is right 37% of the time against a 14% base rate. It's good for prioritizing inspections,
  not for certainty. Risk factors come from swapping each input for the citywide median and listing those that
  raise the score.

```bash
cd server
npm run setup:ml      # creates server/.venv with pandas, scikit-learn, xgboost (macOS: brew install libomp for XGBoost)
npm run train:model   # ~30s; reads data/raw_data.csv or every data/MyLA311-*.csv
```
Put the MyLA311 CSVs (data.lacity.org) in `server/data/`; git ignores them. Training writes `server/models/`
(model, per-location features, `model_metadata.json` with metrics and thresholds) and
`server/data/aggregated_risk_map.json` (top 200 HIGH-risk locations for the map). Those outputs can be committed, so
teammates don't need the 3 GB of raw data, but they do need `npm run setup:ml` for the Python worker. The server
starts one Python process on the first prediction and reuses it. The model only knows history up to the
end of the data (currently 2025-03-31).

## Incident clustering

Fifty calls about one problem should read as one incident with a count of fifty. When a call is saved with a
category and map coordinates, the server (`server/src/clustering.js`) groups it with matching calls:

- **Same issue type** (triage category), **within 150 m**, and **under an hour** from the cluster's latest report.
  The second matching call forms a cluster, and later ones grow it. A cluster is active until an hour passes with
  no new report; then it moves to History. A dispatcher's **Reopen** or **Escalate** holds it in Active until it's
  **Mark resolved** (resolving is always manual, and resolved clusters take no new calls). Calls without a usable location stay individual reports.
- **Safety:** clustering runs in the background after the call is saved, so escalation is never delayed or changed.
  A cluster takes on its most urgent report (Critical or Urgent clusters are escalated).
- Clusters are stored in their own tables (`incident_clusters`, `incident_cluster_members`). Each call belongs to at
  most one cluster. Unique callers are counted by phone number (web test calls each count as distinct).

The **Incident Clusters page**:
- **Ranked cards:** ranked by report count, recency and urgency. Each shows the count (↑ when rising), first and
  latest report, location, unique callers and status. The top, fast-rising and critical
  incidents are bigger and pulse. Filter by issue type, urgency, status/history and time range; sort by priority,
  count or recency.
- **Chart, "Types of inconvenience":** a stacked bar chart of reports per category. Each colored section is one
  cluster, and individual reports are a gray section on top. Hover a section for its location, count and last
  report; click it to open the cluster.
- **Surge banner:** flags any ~1 km area whose reports in the last 30 minutes are at least 4 and at least 3× (+1) its
  usual count for that time of day over the past 2 weeks, even when the issues differ.
- **One official incident report per cluster** (`buildClusterReport` in `server/src/report.js`): it keeps the
  earliest call's incident number and has a combined executive summary, the time window, every caller, de-duplicated
  key facts and the list of calls it consolidates. Routing goes to every agency the calls point to, most urgent
  first (e.g. "911 / Fire & EMS + 911 / Police Dispatch"). It's rebuilt whenever the cluster changes, with Copy and
  Print / PDF like call reports.
- **Cluster detail drawer:** the incident report, plus a Calls tab listing every call (summary, transcript, recording). Dispatchers can escalate, resolve or
  add a note on the whole cluster without changing individual call statuses. They can also split a report out or
  merge two clusters.

Limits: the 150 m and 1 h thresholds are tunable constants. Unrelated nearby issues can be merged, and one issue
described differently can be missed (split and merge exist for that). Unique callers help spot a flood of
coordinated reports.

## How triage works

| Urgency | Meaning | Status |
|---|---|---|
| Critical | Threat to life/safety | Escalated to 911 |
| Urgent | Immediate hazard | Escalated to Human |
| Standard | Routine service request | AI Completed |

Calls are filed into five categories: **Emergency / Active Danger**, **Public Safety & Hazards**,
**Roads & Infrastructure**, **Utilities & Water** and **Code Enforcement & Sanitation**. Click a category pill
or a row in the "By category" panel to show only that category.

1. **During the call:** on any life-safety statement the agent asks no questions and runs `escalate_call`, which
   transfers the caller to `DISPATCH_TRANSFER_NUMBER` (a phone you control, never real 911). With a public URL it
   can also run `request_human` and `log_service_request`. Escalations act as a floor that later automated triage
   can't lower.
2. **`call_ended`:** the transcript and recording are saved, provisional keyword triage runs, and a draft formal
   report is written.
3. **`call_analyzed`:** Retell's post-call analysis sets the final category, urgency and summary, and fills the
   **formal incident report** (`INC-<year>-<n>`, dispatch routing, executive summary, entities, key facts). A
   keyword safety net forces **Critical** if the transcript mentions weapons, injuries, fire, crashes, etc.

The call drawer shows the formal report next to the raw transcript, with **Copy** and **Print / PDF** buttons.
See [docs/retell-agent-setup.md](docs/retell-agent-setup.md) for the prompt, tools and analysis fields.

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
| GET | `/api/maintenance` | Preemptive crew dispatches |
| POST | `/api/maintenance` | Dispatch a crew `{ location, probability, inputs, latitude?, longitude? }` |
| GET | `/api/maintenance/geocode?q=` | Geocode an address or zip (LA area) |
| POST | `/api/predict-degradation` | Streetlight degradation risk `{ zipcode?, latitude?, longitude?, days_since_repair }` |
| GET | `/api/predict-degradation/hotspots` | Precomputed high-risk locations (`aggregated_risk_map.json`) |
| GET | `/api/clusters` | Incident clusters with member call ids (`since`, default 7 days) |
| GET | `/api/clusters/:id` | One cluster with its calls |
| PATCH | `/api/clusters/:id/status` | `{ status: active \| escalated \| resolved, note? }` (cluster only) |
| POST | `/api/clusters/:id/notes` | `{ note }` |
| DELETE | `/api/clusters/:id/members/:callId` | Split a call out of a cluster |
| POST | `/api/clusters/:id/merge` | `{ into }` merge into another same-type cluster |

## Tests
```bash
cd server && npm test    # triage classifier, formal reports, prediction input validation, cluster matching
cd client && npm test    # surge buckets, cluster ranking / chart / surge detection, simulation scenario data
```

## Before production
- **Add authentication** to the dashboard and the `/api/calls` + `/api/retell/web-call` routes (e.g. Supabase
  Auth). They are open in this build, and the anon key can read all calls under the current RLS policy.
- Never route demo transfers to real 911. Configure a test number.
- Call recordings and transcripts may contain personal data, so set a retention policy.
