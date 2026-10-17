# Retell AI Agent Setup

**Automated:** `cd server && npm run setup:retell -- https://YOUR-API` configures everything below except
transfers (§4) and phone numbers. The script's prompt (in `server/scripts/setup-retell.js`) is the source of
truth; the prompt here is a reference. The rest of this page documents the manual equivalent.

Configure these in the [Retell dashboard](https://dashboard.retellai.com). Replace `https://YOUR-API` with your
public backend URL. For local dev, expose port 3001 with a tunnel (e.g. `ngrok http 3001`).

## 1. Webhook

**Agent → Webhook URL:** `https://YOUR-API/webhooks/retell`

Events used: `call_started` (creates the live "In Progress" row), `call_ended` (transcript, recording,
provisional triage), and `call_analyzed` (final triage from post-call analysis). Requests are verified with
the `x-retell-signature` header using your `RETELL_API_KEY`.

## 2. Agent prompt (Single/Multi-Prompt LLM)

```text
You are the AI dispatcher for the City of Los Angeles civic services line. Callers report two kinds of things:
(1) non-emergency city service issues: potholes, broken traffic signals, noise, graffiti, streetlights;
(2) emergencies: crimes in progress, violence, weapons, fires, vehicle accidents with injuries, medical emergencies.

FIRST, within your first one or two turns, decide whether this is an emergency.

IF IT IS AN EMERGENCY (anyone in danger, a crime in progress, injuries, fire, weapons):
- Immediately call `escalate_emergency` with what you know. Don't wait for full details.
- Ask for the exact location if you don't have it, and whether the caller is safe.
- Tell the caller help is being dispatched, then call `transfer_to_911`.
- Keep sentences short and calm. Never put an emergency caller on hold to collect non-essential details.

IF IT IS A SERVICE REQUEST:
- Collect: the issue, the precise location (cross streets or address), and the caller's first name (optional).
- If the issue is an immediate hazard (signals out at a busy intersection, a large pothole on a highway,
  downed power lines, flooding), call `request_human` and transfer to the human dispatcher.
- Otherwise call `log_service_request`, read back the reference number, and tell the caller the city
  will follow up. Then end the call politely.

Never give legal or medical advice. If unsure whether something is an emergency, treat it as one.
```

## 3. Custom functions (Agent → Functions → Custom Function)

| Name | URL | Parameters (JSON schema properties) |
|---|---|---|
| `escalate_emergency` | `https://YOUR-API/api/retell/functions/escalate_emergency` | `emergency_type` (string), `location` (string), `details` (string), `caller_name` (string) |
| `request_human` | `https://YOUR-API/api/retell/functions/request_human` | `reason` (string) |
| `log_service_request` | `https://YOUR-API/api/retell/functions/log_service_request` | `category` (enum: `Potholes`, `Traffic Signals`, `Noise & Other`), `location` (string), `description` (string), `caller_name` (string) |

These functions **record** the escalation on the dashboard. They do **not** place a phone call to 911 themselves.

## 4. Call transfers (built-in "Transfer Call" functions)

- `transfer_to_911`: transfer to your emergency dispatch number. **For demos, use a test number you
  control, never real 911.**
- `transfer_to_dispatcher`: transfer to the human dispatcher line.

Transfers show up on the dashboard via `disconnection_reason: call_transfer`.

## 5. Post-call analysis (Agent → Post-Call Analysis)

Add these custom fields. The backend validates them against the database enums, and falls back to keyword
triage over the transcript if any field is missing or invalid.

| Field | Type | Description / choices |
|---|---|---|
| `category` | Enum | `Public Safety`, `Potholes`, `Traffic Signals`, `Noise & Other` |
| `urgency_level` | Enum | `Critical` (life/safety threat, needs 911), `Urgent` (immediate hazard, needs a human), `Standard` (routine) |
| `summary` | Text | One or two sentence dispatcher-facing summary |
| `location` | Text | Location of the incident as stated by the caller |
| `caller_name` | Text | Caller's name, if given |

Note: a keyword safety net (weapons, injuries, fire, accidents, etc.) will upgrade a call to **Critical** even
if the post-call analysis says otherwise. Explicit escalations (functions, transfers, dispatcher actions) are
never downgraded by later automated triage.
