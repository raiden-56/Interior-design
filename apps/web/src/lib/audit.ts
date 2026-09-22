/**
 * Share-link activity log.
 *
 * Who opened a client link, when, and whether anything tripped the protected
 * view. An architect sending a design to a client wants to know it was seen —
 * and if a watermarked image ever turns up somewhere, this is the trail that
 * says which link it came from.
 *
 * In-process ring buffer: it survives as long as the server does, which is
 * the right amount of machinery for a single-tenant deployment. Swap the two
 * functions below for a table when this becomes multi-tenant.
 */

export interface AuditEvent {
  kind: 'share-opened' | 'share-passcode-failed' | 'capture-attempt' | 'print-attempt' | 'devtools-attempt';
  projectId: string;
  label?: string;
  role?: string;
  userAgent?: string;
  at: number;
}

const MAX_EVENTS = 500;

function store(): AuditEvent[] {
  if (!globalThis.__interiorAudit) globalThis.__interiorAudit = [];
  return globalThis.__interiorAudit;
}

declare global {
  // eslint-disable-next-line no-var
  var __interiorAudit: AuditEvent[] | undefined;
}

export function recordEvent(event: Omit<AuditEvent, 'at'>): void {
  const events = store();
  events.unshift({ ...event, at: Date.now() });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
}

export function recentEvents(projectId?: string, limit = 100): AuditEvent[] {
  const events = store();
  return (projectId ? events.filter((e) => e.projectId === projectId) : events).slice(0, limit);
}
