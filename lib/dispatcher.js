import { listAgents } from './agents.js';
import { createEvent, validateCapabilityLease, validateTaskEnvelope } from './taskEnvelope.js';

const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 5_000;
const ACTIVE_STATES = new Set(['claimed', 'running']);
const TERMINAL_STATES = new Set(['completed', 'dead_letter', 'cancelled']);
const MODE_ALIASES = { subscription_connector: 'subscription_trigger' };
const DEFAULT_MODE_ORDER = ['local', 'api', 'subscription_trigger', 'permanent'];

function modeOf(agent) {
  return MODE_ALIASES[agent.mode] || agent.mode || 'api';
}

function costOf(agent) {
  if (Number.isFinite(agent.cost_tier)) return Number(agent.cost_tier);
  const named = { free: 0, low: 1, medium: 2, high: 3 };
  return named[agent.cost_tier] ?? 2;
}

function usable(agent) {
  return ['online', 'available_on_demand'].includes(agent.status) && agent.state !== 'disabled';
}

function hasCapabilities(agent, required) {
  return required.every((capability) => agent.capabilities.includes(capability));
}

export function approvalRequired(envelope) {
  return ['medium', 'high'].includes(envelope.risk_class);
}

export function chooseDispatchAgent(envelope, agents, { modeOrder = DEFAULT_MODE_ORDER } = {}) {
  const valid = [];
  for (const agent of agents) {
    try {
      validateCapabilityLease(agent);
      if (usable(agent) && hasCapabilities(agent, envelope.required_capabilities)) valid.push(agent);
    } catch {
      // A malformed registry record is never eligible for work.
    }
  }

  const preferred = valid.find((agent) => agent.id === envelope.preferred_agent);
  if (preferred) return { agent: preferred, reason: 'preferred_agent' };

  const optional = valid.filter((agent) => agent.id !== 'nex');
  optional.sort((a, b) => {
    const cost = costOf(a) - costOf(b);
    if (cost) return cost;
    const mode = modeOrder.indexOf(modeOf(a)) - modeOrder.indexOf(modeOf(b));
    if (mode) return mode;
    return String(a.id).localeCompare(String(b.id));
  });
  if (optional.length) return { agent: optional[0], reason: 'capability_cost_mode' };

  const fallbackId = envelope.fallback_agent || 'nex';
  const fallback = valid.find((agent) => agent.id === fallbackId);
  if (fallback) return { agent: fallback, reason: 'fallback_agent' };

  const missing = envelope.required_capabilities.length
    ? `No available agent has all required capabilities: ${envelope.required_capabilities.join(', ')}`
    : 'No available agent';
  return { agent: null, reason: missing };
}

function token() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export class MemoryDispatchStore {
  constructor() {
    this.records = new Map();
    this.idempotency = new Map();
    this.audit = [];
  }

  async get(taskId) { return this.records.get(taskId) || null; }

  async claim({ envelope, agent, now, leaseMs, maxAttempts }) {
    const boundTask = this.idempotency.get(envelope.idempotency_key);
    if (boundTask && boundTask !== envelope.task_id) {
      return { outcome: 'duplicate', record: this.records.get(boundTask) || null };
    }
    const current = this.records.get(envelope.task_id);
    if (current && TERMINAL_STATES.has(current.state)) return { outcome: 'terminal', record: current };
    if (current && ACTIVE_STATES.has(current.state) && current.lease_expires_at > now) {
      return { outcome: 'owned', record: current };
    }
    if (current?.state === 'retry_wait' && current.next_retry_at > now) {
      return { outcome: 'retry_wait', record: current };
    }
    const attempts = (current?.attempts || 0) + 1;
    if (attempts > maxAttempts) {
      const dead = { ...current, task_id: envelope.task_id, tenant_id: envelope.tenant_id,
        idempotency_key: envelope.idempotency_key, state: 'dead_letter', owner: null,
        lease_token: null, lease_expires_at: null, updated_at: now,
        reason: 'attempt_limit_exceeded' };
      this.records.set(envelope.task_id, dead);
      return { outcome: 'dead_letter', record: dead };
    }
    const record = { ...current, task_id: envelope.task_id, tenant_id: envelope.tenant_id,
      trace_id: envelope.trace_id, idempotency_key: envelope.idempotency_key,
      state: 'claimed', owner: agent.id, agent_mode: modeOf(agent), cost_tier: costOf(agent),
      lease_token: token(), lease_expires_at: now + leaseMs, attempts,
      max_attempts: maxAttempts, next_retry_at: null, reason: null,
      created_at: current?.created_at || now, updated_at: now };
    this.idempotency.set(envelope.idempotency_key, envelope.task_id);
    this.records.set(envelope.task_id, record);
    return { outcome: 'claimed', record };
  }

  async heartbeat({ taskId, agentId, leaseToken, now, leaseMs }) {
    const record = this.records.get(taskId);
    if (!record || record.owner !== agentId || record.lease_token !== leaseToken ||
        !ACTIVE_STATES.has(record.state) || record.lease_expires_at <= now) return null;
    record.state = 'running';
    record.lease_expires_at = now + leaseMs;
    record.updated_at = now;
    return record;
  }

  async complete({ taskId, agentId, leaseToken, result, now }) {
    const record = this.records.get(taskId);
    if (!record || record.owner !== agentId || record.lease_token !== leaseToken ||
        !ACTIVE_STATES.has(record.state) || record.lease_expires_at <= now) return null;
    Object.assign(record, { state: 'completed', result, owner: null, lease_token: null,
      lease_expires_at: null, updated_at: now });
    return record;
  }

  async fail({ taskId, agentId, leaseToken, error, now, backoffMs }) {
    const record = this.records.get(taskId);
    if (!record || record.owner !== agentId || record.lease_token !== leaseToken ||
        !ACTIVE_STATES.has(record.state) || record.lease_expires_at <= now) return null;
    const exhausted = record.attempts >= record.max_attempts;
    Object.assign(record, { state: exhausted ? 'dead_letter' : 'retry_wait', error,
      reason: exhausted ? 'attempt_limit_exceeded' : 'worker_failed', owner: null,
      lease_token: null, lease_expires_at: null,
      next_retry_at: exhausted ? null : now + backoffMs, updated_at: now });
    return record;
  }

  async handoff({ taskId, fromAgentId, fromLeaseToken, toAgent, now, leaseMs }) {
    const record = this.records.get(taskId);
    if (!record || record.owner !== fromAgentId || record.lease_token !== fromLeaseToken ||
        !ACTIVE_STATES.has(record.state) || record.lease_expires_at <= now) return null;
    Object.assign(record, { owner: toAgent.id, agent_mode: modeOf(toAgent),
      cost_tier: costOf(toAgent), lease_token: token(), lease_expires_at: now + leaseMs,
      state: 'claimed', updated_at: now });
    return record;
  }

  async recoverExpired(now) {
    const recovered = [];
    for (const record of this.records.values()) {
      if (ACTIVE_STATES.has(record.state) && record.lease_expires_at <= now) {
        Object.assign(record, { state: 'retry_wait', reason: 'lease_expired', owner: null,
          lease_token: null, lease_expires_at: null, next_retry_at: now, updated_at: now });
        recovered.push(record);
      }
    }
    return recovered;
  }

  async appendAudit(event) { this.audit.push(event); }
}

const CLAIM_SCRIPT = `
local task_key = KEYS[1]
local idem_key = KEYS[2]
local active_key = KEYS[3]
local task_id = ARGV[1]
local now = tonumber(ARGV[2])
local lease_expires = tonumber(ARGV[3])
local max_attempts = tonumber(ARGV[4])
local record_json = ARGV[5]
local bound = redis.call('GET', idem_key)
if bound and bound ~= task_id then return {'duplicate', bound} end
local raw = redis.call('GET', task_key)
local attempts = 1
if raw then
  local old = cjson.decode(raw)
  if old.state == 'completed' or old.state == 'dead_letter' or old.state == 'cancelled' then
    return {'terminal', raw}
  end
  if (old.state == 'claimed' or old.state == 'running') and tonumber(old.lease_expires_at or 0) > now then
    return {'owned', raw}
  end
  if old.state == 'retry_wait' and tonumber(old.next_retry_at or 0) > now then
    return {'retry_wait', raw}
  end
  attempts = tonumber(old.attempts or 0) + 1
end
if attempts > max_attempts then
  local dead = cjson.decode(record_json)
  dead.state = 'dead_letter'; dead.owner = cjson.null; dead.lease_token = cjson.null
  dead.lease_expires_at = cjson.null; dead.attempts = attempts - 1
  dead.reason = 'attempt_limit_exceeded'; dead.updated_at = now
  local encoded = cjson.encode(dead)
  redis.call('SET', task_key, encoded); redis.call('SETNX', idem_key, task_id); redis.call('SREM', active_key, task_key)
  return {'dead_letter', encoded}
end
local next = cjson.decode(record_json)
next.attempts = attempts; next.lease_expires_at = lease_expires
local encoded = cjson.encode(next)
redis.call('SET', task_key, encoded); redis.call('SETNX', idem_key, task_id); redis.call('SADD', active_key, task_key)
return {'claimed', encoded}
`;

export class RedisDispatchStore {
  constructor({ url = process.env.KV_REST_API_URL, token: auth = process.env.KV_REST_API_TOKEN,
    prefix = 'nexus:dispatch' } = {}) {
    if (!url || !auth) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
    this.url = url; this.auth = auth; this.prefix = prefix;
  }
  async command(command) {
    const response = await fetch(this.url, { method: 'POST', headers: {
      Authorization: `Bearer ${this.auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Dispatcher Redis ${command[0]} failed`);
    return data.result;
  }
  taskKey(id) { return `${this.prefix}:task:${id}`; }
  idemKey(id) { return `${this.prefix}:idem:${id}`; }
  async get(taskId) {
    const raw = await this.command(['GET', this.taskKey(taskId)]);
    return raw ? JSON.parse(raw) : null;
  }
  async claim({ envelope, agent, now, leaseMs, maxAttempts }) {
    const record = { task_id: envelope.task_id, tenant_id: envelope.tenant_id,
      trace_id: envelope.trace_id, idempotency_key: envelope.idempotency_key,
      state: 'claimed', owner: agent.id, agent_mode: modeOf(agent), cost_tier: costOf(agent),
      lease_token: token(), attempts: 1, max_attempts: maxAttempts,
      next_retry_at: null, reason: null, created_at: now, updated_at: now };
    const result = await this.command(['EVAL', CLAIM_SCRIPT, '3', this.taskKey(envelope.task_id),
      this.idemKey(envelope.idempotency_key), `${this.prefix}:active`, envelope.task_id, String(now),
      String(now + leaseMs), String(maxAttempts), JSON.stringify(record)]);
    const [outcome, raw] = result;
    return { outcome, record: raw?.startsWith?.('{') ? JSON.parse(raw) : await this.get(envelope.task_id) };
  }
  async mutateOwned({ taskId, agentId, leaseToken, now, mutate, args = [] }) {
    const key = this.taskKey(taskId);
    const script = `local raw=redis.call('GET',KEYS[1]); if not raw then return nil end
      local r=cjson.decode(raw); if r.owner~=ARGV[1] or r.lease_token~=ARGV[2] then return nil end
      if r.state~='claimed' and r.state~='running' then return nil end
      if tonumber(r.lease_expires_at or 0)<=tonumber(ARGV[3]) then return nil end
      ${mutate} local out=cjson.encode(r); redis.call('SET',KEYS[1],out); return out`;
    const raw = await this.command(['EVAL', script, '2', key, `${this.prefix}:active`, agentId, leaseToken, String(now), ...args.map(String)]);
    return raw ? JSON.parse(raw) : null;
  }
  heartbeat({ taskId, agentId, leaseToken, now, leaseMs }) {
    return this.mutateOwned({ taskId, agentId, leaseToken, now,
      args: [now + leaseMs],
      mutate: "r.state='running'; r.lease_expires_at=tonumber(ARGV[4]); r.updated_at=tonumber(ARGV[3]);" });
  }
  complete({ taskId, agentId, leaseToken, result, now }) {
    return this.mutateOwned({ taskId, agentId, leaseToken, now,
      args: [JSON.stringify(result ?? null)],
      mutate: "r.state='completed'; r.result=cjson.decode(ARGV[4]); r.owner=cjson.null; r.lease_token=cjson.null; r.lease_expires_at=cjson.null; r.updated_at=tonumber(ARGV[3]); redis.call('SREM',KEYS[2],KEYS[1]);" });
  }
  fail({ taskId, agentId, leaseToken, error, now, backoffMs }) {
    return this.mutateOwned({ taskId, agentId, leaseToken, now,
      args: [String(error), now + backoffMs],
      mutate: "if tonumber(r.attempts)>=tonumber(r.max_attempts) then r.state='dead_letter'; r.reason='attempt_limit_exceeded'; r.next_retry_at=cjson.null else r.state='retry_wait'; r.reason='worker_failed'; r.next_retry_at=tonumber(ARGV[5]) end r.error=ARGV[4]; r.owner=cjson.null; r.lease_token=cjson.null; r.lease_expires_at=cjson.null; r.updated_at=tonumber(ARGV[3]); redis.call('SREM',KEYS[2],KEYS[1]);" });
  }
  handoff({ taskId, fromAgentId, fromLeaseToken, toAgent, now, leaseMs }) {
    const nextToken = token();
    return this.mutateOwned({ taskId, agentId: fromAgentId, leaseToken: fromLeaseToken, now,
      args: [toAgent.id, modeOf(toAgent), costOf(toAgent), nextToken, now + leaseMs],
      mutate: "r.owner=ARGV[4]; r.agent_mode=ARGV[5]; r.cost_tier=tonumber(ARGV[6]); r.lease_token=ARGV[7]; r.lease_expires_at=tonumber(ARGV[8]); r.state='claimed'; r.updated_at=tonumber(ARGV[3]);" });
  }
  async recoverExpired(now) {
    // Production recovery is intentionally index-driven; claim keys are added to this set by callers.
    const keys = await this.command(['SMEMBERS', `${this.prefix}:active`]) || [];
    const recovered = [];
    for (const key of keys) {
      const script = `local raw=redis.call('GET',KEYS[1]); if not raw then redis.call('SREM',KEYS[2],KEYS[1]); return nil end local r=cjson.decode(raw); if (r.state=='claimed' or r.state=='running') and tonumber(r.lease_expires_at or 0)<=tonumber(ARGV[1]) then r.state='retry_wait'; r.reason='lease_expired'; r.owner=cjson.null; r.lease_token=cjson.null; r.lease_expires_at=cjson.null; r.next_retry_at=tonumber(ARGV[1]); r.updated_at=tonumber(ARGV[1]); local out=cjson.encode(r); redis.call('SET',KEYS[1],out); redis.call('SREM',KEYS[2],KEYS[1]); return out end return nil`;
      const raw = await this.command(['EVAL', script, '2', key, `${this.prefix}:active`, String(now)]);
      if (raw) recovered.push(JSON.parse(raw));
    }
    return recovered;
  }
  appendAudit(event) { return this.command(['LPUSH', `${this.prefix}:audit`, JSON.stringify(event)]); }
}

export function createDispatcher({ store, listAgentsFn = listAgents, now = () => Date.now(),
  leaseMs = DEFAULT_LEASE_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS,
  backoffMs = DEFAULT_BACKOFF_MS } = {}) {
  if (!store) throw new Error('Dispatcher store is required');
  const audit = async (type, envelope, data) => store.appendAudit(createEvent(type, envelope, data));

  return {
    async dispatch(envelope) {
      validateTaskEnvelope(envelope);
      if (envelope.approval_state === 'rejected') return { status: 'rejected', reason: 'Task approval was rejected' };
      if (approvalRequired(envelope) && envelope.approval_state !== 'approved') {
        return { status: 'pending_approval', reason: `${envelope.risk_class} risk requires approval` };
      }
      const agents = await listAgentsFn();
      const selected = chooseDispatchAgent(envelope, agents);
      if (!selected.agent) return { status: 'pending_agent', reason: selected.reason };
      const claimed = await store.claim({ envelope, agent: selected.agent, now: now(), leaseMs, maxAttempts });
      if (claimed.outcome === 'claimed') await audit('dispatched', envelope, { agent_id: selected.agent.id, attempt: claimed.record.attempts });
      if (claimed.outcome === 'dead_letter') await audit('failed', envelope, { reason: claimed.record.reason });
      return { status: claimed.outcome, agent: selected.agent, record: claimed.record, reason: selected.reason };
    },
    async heartbeat(envelope, credentials) {
      const record = await store.heartbeat({ taskId: envelope.task_id, ...credentials, now: now(), leaseMs });
      if (record) await audit('progress', envelope, { agent_id: credentials.agentId, heartbeat: true });
      return record;
    },
    async complete(envelope, credentials, result) {
      const record = await store.complete({ taskId: envelope.task_id, ...credentials, result, now: now() });
      if (record) await audit('completed', envelope, { result });
      return record;
    },
    async fail(envelope, credentials, error) {
      const current = await store.get(envelope.task_id);
      const delay = backoffMs * (2 ** Math.max(0, (current?.attempts || 1) - 1));
      const record = await store.fail({ taskId: envelope.task_id, ...credentials,
        error: String(error), now: now(), backoffMs: delay });
      if (record) await audit('failed', envelope, { reason: record.reason, retry_at: record.next_retry_at });
      return record;
    },
    async handoff(envelope, credentials, toAgent) {
      validateCapabilityLease(toAgent);
      if (!usable(toAgent) || !hasCapabilities(toAgent, envelope.required_capabilities)) return null;
      const record = await store.handoff({ taskId: envelope.task_id,
        fromAgentId: credentials.agentId, fromLeaseToken: credentials.leaseToken,
        toAgent, now: now(), leaseMs });
      if (record) await audit('claimed', envelope, { agent_id: toAgent.id, handoff_from: credentials.agentId });
      return record;
    },
    recoverExpired() { return store.recoverExpired(now()); },
  };
}
