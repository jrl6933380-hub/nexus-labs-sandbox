// /lib/routineWake.js
// Epic task 03 — the actual "wake" step for a subscription_connector-mode
// worker. The dispatcher (task 02) claims a lease and marks a task
// 'claimed'/'planning' on the board, but nothing was ever *waking* the
// worker to come do it. This module is that missing piece for Claude
// specifically, via Claude Code Routines' API trigger (research preview,
// `/fire` endpoint under the `experimental-cc-routine-2026-04-01` beta
// header).
//
// SECURITY CONTRACT (per task 03's acceptance criteria):
// - The routine trigger token lives ONLY in process.env, read at call
//   time. It is never logged, never written to the board, never placed
//   in a prompt, and never committed to the repo.
// - The payload sent to /fire is a MINIMAL, UNTRUSTED reference only —
//   task_id, trace_id, tenant_id, and a pointer back to Nexus. It is NOT
//   the task's full goal/constraints/acceptance_criteria. The woken
//   Claude session reads the real instructions itself, through the
//   Nexus MCP connector, using its own authenticated tool calls — the
//   fire payload is not a trusted instruction channel and must never be
//   treated like one.
// - Firing is idempotent per envelope.idempotency_key: a replayed
//   dispatch (duplicate board-approval event, retried request, etc.)
//   returns the SAME session record instead of starting a second Claude
//   session for the same task.
//
// INCIDENT NOTE (kept here on purpose, not just in the board log): an
// earlier version of this file caught fetch()'s network-level error and
// interpolated `err.message` directly into the thrown error. When
// CLAUDE_ROUTINE_FIRE_URL was misconfigured to actually hold the trigger
// token instead of a URL, Node's URL parser echoed the invalid input
// (the token) verbatim into that error message — which then flowed
// through boardDispatcher's wake-failure handler into a board task's
// blocked_reason, in production, briefly exposing it on the shared
// board. The fix below is two-layered: (1) validate fireUrl as a real
// URL BEFORE it ever reaches fetch(), with a clean error that never
// echoes the invalid value, and (2) redact the trigger token out of any
// error message before it's thrown, as defense in depth in case some
// other failure mode echoes it back some other way.

const BETA_HEADER = 'experimental-cc-routine-2026-04-01';
const WAKE_KEY_PREFIX = 'nexus:routine-wake';

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Strips a known secret value out of a string before it's ever thrown
// or logged. Defense in depth on top of the upfront URL validation —
// covers any other failure mode that might otherwise echo the token.
function redact(message, ...secrets) {
  let safe = String(message);
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}

// Swappable ledger so a replayed fire returns the prior session instead
// of starting a second one. Defaults to an in-memory Map (fine for a
// single process / tests); production wiring should pass a Redis-backed
// store with the same {get, set} shape, keyed by KV_REST_API_URL/TOKEN
// like the rest of lib/ already does.
export function createMemoryWakeLedger() {
  const map = new Map();
  return {
    async get(key) { return map.get(key) || null; },
    async set(key, value) { map.set(key, value); },
  };
}

export function createRedisWakeLedger({ url = process.env.KV_REST_API_URL,
  token: auth = process.env.KV_REST_API_TOKEN, prefix = WAKE_KEY_PREFIX,
  fetchImpl = fetch } = {}) {
  if (!url || !auth) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  async function command(cmd) {
    const res = await fetchImpl(url, { method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd) });
    const data = await res.json();
    if (!res.ok) throw new Error(`Wake ledger Redis ${cmd[0]} failed`);
    return data.result;
  }
  return {
    async get(key) {
      const raw = await command(['GET', `${prefix}:${key}`]);
      return raw ? JSON.parse(raw) : null;
    },
    async set(key, value) {
      // 24h TTL — a wake record only needs to survive long enough to
      // absorb realistic retry/replay windows, not forever.
      await command(['SET', `${prefix}:${key}`, JSON.stringify(value), 'EX', '86400']);
    },
  };
}

/**
 * Fire the Claude Routine that should pick up this task. Minimal,
 * untrusted payload only — see the module header for why.
 *
 * @param {import('./taskEnvelope.js').TaskEnvelope} envelope
 * @param {{
 *   ledger?: {get: Function, set: Function},
 *   fetchImpl?: typeof fetch,
 *   fireUrl?: string,
 *   triggerToken?: string,
 *   connectorUrl?: string,
 * }} [options]
 * @returns {Promise<{session_id: string, session_url: string, replayed: boolean}>}
 */
export async function fireClaudeRoutine(envelope, options = {}) {
  const ledger = options.ledger || createMemoryWakeLedger();
  const fetchImpl = options.fetchImpl || fetch;

  const existing = await ledger.get(envelope.idempotency_key);
  if (existing) return { ...existing, replayed: true };

  const fireUrl = options.fireUrl || env('CLAUDE_ROUTINE_FIRE_URL');
  const triggerToken = options.triggerToken || env('CLAUDE_ROUTINE_TRIGGER_TOKEN');
  const connectorUrl = options.connectorUrl || process.env.NEXUS_MCP_CONNECTOR_URL || null;

  // Layer 1: validate BEFORE fetch ever sees it. A malformed value here
  // (e.g. the two env vars swapped, so fireUrl actually holds a token)
  // must never have its raw content echoed back — that's exactly how
  // the token leaked onto the board previously. This check is what
  // prevents that failure mode from recurring, not just handles it.
  let parsedUrl;
  try {
    parsedUrl = new URL(fireUrl);
  } catch {
    throw new Error(
      'CLAUDE_ROUTINE_FIRE_URL is not a valid URL. Check that it and CLAUDE_ROUTINE_TRIGGER_TOKEN ' +
      'are not swapped in Vercel — this error intentionally does not echo the configured value.'
    );
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('CLAUDE_ROUTINE_FIRE_URL must be an http(s) URL.');
  }

  const payload = {
    // Minimal + untrusted on purpose — see module header. The woken
    // session fetches the real task via the Nexus MCP connector.
    task_id: envelope.task_id,
    trace_id: envelope.trace_id,
    tenant_id: envelope.tenant_id,
    connector_url: connectorUrl,
    message: `Nexus board task ${envelope.task_id} is approved and assigned to you. ` +
      `Read the full task via the Nexus MCP connector before doing anything else.`,
  };

  let response;
  try {
    response = await fetchImpl(fireUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${triggerToken}`,
        'anthropic-beta': BETA_HEADER,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Layer 2: defense in depth. The URL is already validated above, so
    // this should be a genuine network-level failure (DNS, timeout,
    // connection refused) — but redact the token out regardless, in
    // case some other runtime/proxy echoes request details back.
    throw new Error(`Claude Routine fire request failed: ${redact(err.message, triggerToken, fireUrl)}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Claude Routine fire rejected: ${redact(reason, triggerToken)}`);
  }
  if (!body.claude_code_session_id) {
    throw new Error('Claude Routine fire response missing claude_code_session_id');
  }

  const record = {
    session_id: body.claude_code_session_id,
    session_url: body.claude_code_session_url,
    fired_at: Date.now(),
  };
  await ledger.set(envelope.idempotency_key, record);
  return { ...record, replayed: false };
}
