/**
 * @param {string} event Human-readable label shown on the dashboard
 * @param {string} [detail]
 * @param {string} [escalatedTo] Set for explicit escalations (agent function, transfer,
 *   dispatcher). These act as a floor that later automated triage can't downgrade.
 */
export function timelineEvent(event, detail, escalatedTo) {
  return { at: new Date().toISOString(), event, ...(detail ? { detail } : {}), ...(escalatedTo ? { escalated_to: escalatedTo } : {}) };
}
