# Retell AI Agent Setup

Everything here is configured by one re-runnable command:

```bash
cd server
npm run setup:retell                       # no public URL: server polls Retell for calls
npm run setup:retell -- https://YOUR-API   # with a public URL: webhooks + mid-call functions
```

Rerun it whenever the prompt, the public URL or `DISPATCH_TRANSFER_NUMBER` changes. Each run creates and
publishes a new **version** of the same "CivicLine Dispatch" agent (not a new agent). Phone numbers are bought
separately in the Retell dashboard (Phone Numbers → Buy), with the inbound agent set to **CivicLine Dispatch**.

Retell pins each phone number to a specific agent version. After publishing, the script moves every number that
routes to CivicLine Dispatch to the new version, so phone calls and browser test calls run the same config.

## Prompt

Source of truth: [`prompts/retell_system_prompt.md`](../prompts/retell_system_prompt.md). The script fills the
`<<PLACEHOLDERS>>` for the current mode. `{{ }}` is not used because Retell reserves it for its own variables.

The prompt starts with an **immediate escalation override**. On any life-safety statement ("I'm going to die",
"he has a gun", "I can't breathe", "someone is breaking in", "there is a fire"…), the agent asks no questions
and responds as follows:

| `DISPATCH_TRANSFER_NUMBER` | Agent says | Then |
|---|---|---|
| Set (e.g. `+12135551234`) | "I am connecting you to an emergency dispatch team right now. Please stay on the line." | Runs `escalate_call` (cold transfer to that number) |
| Empty | "This is an emergency. Please hang up and dial 911 now." | Asks nothing further |

Use a phone **you control** as stand-in dispatch. **Never real 911.**

## Tools

| Tool | Type | Needs public URL | Purpose |
|---|---|---|---|
| `end_call` | built-in | No | End the call |
| `escalate_call` | built-in transfer | No | Emergency transfer to `DISPATCH_TRANSFER_NUMBER`. The dashboard marks the call Critical / Escalated to 911 when the transfer happens. |
| `request_human` | custom → `/api/retell/functions/request_human` | Yes | Flag an urgent hazard for a human dispatcher |
| `log_service_request` | custom → `/api/retell/functions/log_service_request` | Yes | Log a routine report and return a reference number |

## Categories

| Category | Priority | Examples |
|---|---|---|
| Emergency / Active Danger | Critical (red) | Active crime, crashes with injuries, fires, medical emergencies, weapons, domestic violence |
| Public Safety & Hazards | High (yellow) | Downed power lines, gas leaks, open fire hydrants, blocked intersections, active flooding |
| Roads & Infrastructure | Standard (blue) | Potholes, broken traffic lights, damaged signs, sidewalk cracks, street light outages |
| Utilities & Water | Standard (blue) | Water main breaks, sewer backups, power outages, fallen trees |
| Code Enforcement & Sanitation | Routine (gray) | Illegal dumping, noise, abandoned vehicles, missed trash, graffiti |

Emergency is always Critical, and Hazards are at least Urgent. A keyword safety net in `server/src/triage.js`
forces Critical on life-safety words even if the AI analysis says otherwise.

## Post-call analysis fields

| Field | Type | Used for |
|---|---|---|
| `category` | enum (above) | Category |
| `urgency_level` | enum `Critical` / `Urgent` / `Standard` | Urgency, and from it the status |
| `summary` | text | Dashboard summary |
| `location`, `caller_name` | text | Call details |
| `executive_summary` | text | Formal report: official-tone summary |
| `dispatch_recommendation` | enum: `911 / Police Dispatch`, `911 / Fire & EMS`, `Public Works`, `Water & Power`, `Sanitation & Code Enforcement`, `No Dispatch Required` | Formal report: routing |
| `incident_type`, `involved_parties` | text | Formal report: entities |
| `key_facts` | text, one per line | Formal report: key facts |

`server/src/report.js` assembles these into `calls.formal_report`, filling anything missing from the call
record. Its `incident_id` is `INC-<year>-<sequence>`.
