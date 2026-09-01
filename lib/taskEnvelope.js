// /lib/taskEnvelope.js
// Task envelope, capability-lease, and event contracts — epic task 01.
// Provider-neutral schemas so the dispatcher (task 02), the Claude
// Routine wake-slice (task 03), and any future worker type all speak
// the same shape, instead of each caller inventing its own.
//
// This module is purely additive: it does NOT change how lib/board.js
// stores tasks, and lib/board.js is not modified by this file. Old
// board tasks stay exactly as they are — toEnvelope() below is a
// read-side adapter that wraps one in a valid envelope on demand,
// which is what keeps "old tasks remain readable" true without a
// storage migration.

export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'created',
  'approved',
  'dispatched',
  'claimed',
  'progress',
  'blocked',
  'completed',
  'failed',
  'verified',
  'cancelled',
];

// How much independent judgment a worker can use before Mr. Lopez
// has to sign off. The dispatcher (task 02) is what actually reads
// this and decides; this module only defines and validates the value.
export const RISK_CLASSES = ['read_only', 'low', 'medium', 'high'];

export const APPROVAL_STATES = ['not_required', 'pending', 'approved', 'rejected'];

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainArray(value) {
  return Array.isArray(value);
}

/**
 * @typedef {Object} TaskEnvelope
 * @property {number} schema_version
 * @property {string} task_id
 * @property {string} tenant_id - Single-tenant today ("default"); kept
 *   real from day one so multi-tenant (epic task 09) doesn't need a
 *   migration later.
 * @property {?string} project_id
 * @property {string} goal - Plain-language description of what done looks like.
 * @property {string[]} constraints
 * @property {string[]} acceptance_criteria
 * @property {string[]} required_capabilities - Matched against an
 *   agent's `capabilities` array from lib/agents.js.
 * @property {'read_only'|'low'|'medium'|'high'} risk_class
 * @property {'not_required'|'pending'|'approved'|'rejected'} approval_state
 * @property {?string} preferred_agent - Agent id from lib/agents.js, or null.
 * @property {?string} fallback_agent
 * @property {?number} budget - Max spend in USD for this task, or null for no cap.
 * @property {?string} deadline - ISO 8601 datetime, or null.
 * @property {number} attempt - 1-indexed; incremented on retry.
 * @property {string} idempotency_key - Duplicate triggers with the same
 *   key must not cause duplicate work (task 02's job to enforce; this
 *   module just guarantees the field exists and is valid).
 * @property {string} created_by - "justin" | "nex" | "claude" | "chatgpt" | "legacy-board" | etc.
 * @property {string} trace_id - Carried through every event for this task.
 */

/**
 * @typedef {Object} TaskEvent
 * @property {'created'|'approved'|'dispatched'|'claimed'|'progress'|'blocked'|'completed'|'failed'|'verified'|'cancelled'} type
 * @property {string} task_id
 * @property {string} tenant_id
 * @property {string} trace_id
 * @property {number} at - Date.now() timestamp.
 * @property {*} data - Type-specific payload; shape depends on `type`.
 */

/**
 * Capability lease — this is a *contract* on top of the agent shape
 * lib/agents.js already normalizes (id, provider, display_name,
 * model_type, mode, state, capabilities, last_seen, lease_expires_at,
 * status). Not reimplemented here on purpose — validateCapabilityLease
 * below just sanity-checks that a registry record actually matches
 * this shape before a dispatcher trusts it.
 * @typedef {Object} CapabilityLease
 * @property {string} id
 * @property {string[]} capabilities
 * @property {string} status - 'online'|'busy'|'available_on_demand'|'offline'|'disabled'
 * @property {?number} lease_expires_at
 */

/**
 * Builds a valid, fully-defaulted task envelope. Only `goal` is
 * required — everything else has a sane default so a minimal caller
 * ("just give me an envelope for this goal") and a fully-specified
 * one both work.
 *
 * @example
 * createTaskEnvelope({ goal: 'Fix the mobile nav overlap' })
 * // -> { schema_version: 1, task_id: '...', tenant_id: 'default',
 * //      goal: 'Fix the mobile nav overlap', risk_class: 'medium', ... }
 *
 * @example
 * createTaskEnvelope({
 *   goal: 'Add Stripe checkout to the client site',
 *   required_capabilities: ['coding', 'payments'],
 *   risk_class: 'high',
 *   preferred_agent: 'claude',
 *   budget: 5,
 * })
 *
 * @param {Partial<TaskEnvelope>} input
 * @returns {TaskEnvelope}
 */
export function createTaskEnvelope(input = {}) {
  const now = Date.now();
  const task_id = input.task_id || generateId();
  const trace_id = input.trace_id || task_id;
  const idempotency_key = input.idempotency_key || task_id;

  const envelope = {
    schema_version: SCHEMA_VERSION,
    task_id,
    tenant_id: input.tenant_id || 'default',
    project_id: input.project_id ?? null,
    goal: input.goal,
    constraints: input.constraints || [],
    acceptance_criteria: input.acceptance_criteria || [],
    required_capabilities: input.required_capabilities || [],
    risk_class: input.risk_class || 'medium',
    approval_state: input.approval_state || 'pending',
    preferred_agent: input.preferred_agent ?? null,
    fallback_agent: input.fallback_agent ?? null,
    budget: input.budget ?? null,
    deadline: input.deadline ?? null,
    attempt: input.attempt || 1,
    idempotency_key,
    created_by: input.created_by || 'unknown',
    trace_id,
    created_at: input.created_at || now,
  };

  validateTaskEnvelope(envelope);
  return envelope;
}

/**
 * Throws a single Error listing every problem found, rather than
 * stopping at the first one — cheaper to fix a malformed payload when
 * you see all the issues at once. Malformed and cross-tenant payloads
 * (via assertSameTenant, below) are both rejected this way.
 *
 * @param {TaskEnvelope} envelope
 * @throws {Error}
 */
export function validateTaskEnvelope(envelope) {
  const issues = [];
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Task envelope must be an object');
  }

  if (envelope.schema_version !== SCHEMA_VERSION) {
    issues.push(`schema_version must be ${SCHEMA_VERSION}, got ${envelope.schema_version}`);
  }
  if (!isNonEmptyString(envelope.task_id)) issues.push('task_id is required');
  if (!isNonEmptyString(envelope.tenant_id) || !ID_PATTERN.test(envelope.tenant_id)) {
    issues.push('tenant_id is required and must match ' + ID_PATTERN);
  }
  if (!isNonEmptyString(envelope.goal)) issues.push('goal is required');
  if (!isPlainArray(envelope.constraints)) issues.push('constraints must be an array');
  if (!isPlainArray(envelope.acceptance_criteria)) issues.push('acceptance_criteria must be an array');
  if (!isPlainArray(envelope.required_capabilities)) issues.push('required_capabilities must be an array');
  if (!RISK_CLASSES.includes(envelope.risk_class)) {
    issues.push(`risk_class must be one of ${RISK_CLASSES.join(', ')}`);
  }
  if (!APPROVAL_STATES.includes(envelope.approval_state)) {
    issues.push(`approval_state must be one of ${APPROVAL_STATES.join(', ')}`);
  }
  if (envelope.budget != null && typeof envelope.budget !== 'number') {
    issues.push('budget must be a number or null');
  }
  if (envelope.deadline != null && Number.isNaN(Date.parse(envelope.deadline))) {
    issues.push('deadline must be a valid ISO datetime string or null');
  }
  if (!Number.isInteger(envelope.attempt) || envelope.attempt < 1) {
    issues.push('attempt must be an integer >= 1');
  }
  if (!isNonEmptyString(envelope.idempotency_key)) issues.push('idempotency_key is required');
  if (!isNonEmptyString(envelope.created_by)) issues.push('created_by is required');
  if (!isNonEmptyString(envelope.trace_id)) issues.push('trace_id is required');

  if (issues.length) {
    throw new Error(`Invalid task envelope: ${issues.join('; ')}`);
  }
}

/**
 * Guards against cross-tenant contamination — e.g. before letting a
 * dispatcher act on a task using another task's context. Throws
 * rather than silently proceeding.
 *
 * @param {TaskEnvelope} a
 * @param {TaskEnvelope} b
 * @throws {Error}
 */
export function assertSameTenant(a, b) {
  if (!a || !b || a.tenant_id !== b.tenant_id) {
    throw new Error(
      `Cross-tenant operation rejected: "${a?.tenant_id}" vs "${b?.tenant_id}"`
    );
  }
}

/**
 * @param {typeof EVENT_TYPES[number]} type
 * @param {TaskEnvelope} envelope
 * @param {*} [data]
 * @returns {TaskEvent}
 *
 * @example
 * createEvent('claimed', envelope, { agent_id: 'claude' })
 */
export function createEvent(type, envelope, data = null) {
  const event = {
    type,
    task_id: envelope.task_id,
    tenant_id: envelope.tenant_id,
    trace_id: envelope.trace_id,
    at: Date.now(),
    data,
  };
  validateEvent(event);
  return event;
}

/**
 * @param {TaskEvent} event
 * @throws {Error}
 */
export function validateEvent(event) {
  const issues = [];
  if (!event || typeof event !== 'object') throw new Error('Event must be an object');
  if (!EVENT_TYPES.includes(event.type)) issues.push(`type must be one of ${EVENT_TYPES.join(', ')}`);
  if (!isNonEmptyString(event.task_id)) issues.push('task_id is required');
  if (!isNonEmptyString(event.tenant_id)) issues.push('tenant_id is required');
  if (!isNonEmptyString(event.trace_id)) issues.push('trace_id is required');
  if (typeof event.at !== 'number') issues.push('at must be a numeric timestamp');

  if (issues.length) {
    throw new Error(`Invalid task event: ${issues.join('; ')}`);
  }
}

/**
 * Migration path for "old tasks remain readable": wraps an existing
 * lib/board.js task (the plain {id, title, description, status,
 * owner, ...} shape, unversioned) in a valid, current-schema
 * envelope, on read, without touching how it's stored. Every real
 * board task has at least `id` and `title` (createTask requires
 * title), so this never fails on real data.
 *
 * @param {{id: string, title: string, description?: string, owner?: ?string, created_at?: number}} boardTask
 * @param {Partial<TaskEnvelope>} [overrides]
 * @returns {TaskEnvelope}
 *
 * @example
 * const [oldTask] = await listTasks(); // from lib/board.js
 * const envelope = toEnvelope(oldTask);
 */
export function toEnvelope(boardTask, overrides = {}) {
  return createTaskEnvelope({
    task_id: boardTask.id,
    goal: boardTask.title,
    acceptance_criteria: boardTask.description ? [boardTask.description] : [],
    approval_state: boardTask.owner ? 'approved' : 'pending',
    preferred_agent: boardTask.owner || null,
    idempotency_key: boardTask.id,
    trace_id: boardTask.id,
    created_by: 'legacy-board',
    created_at: boardTask.created_at,
    ...overrides,
  });
}

/**
 * Light structural check on a lib/agents.js registry record before a
 * dispatcher trusts it — catches a malformed or hand-edited Redis
 * entry rather than routing work to garbage.
 *
 * @param {CapabilityLease} agent
 * @throws {Error}
 */
export function validateCapabilityLease(agent) {
  const issues = [];
  if (!agent || typeof agent !== 'object') throw new Error('Agent record must be an object');
  if (!isNonEmptyString(agent.id)) issues.push('id is required');
  if (!isPlainArray(agent.capabilities)) issues.push('capabilities must be an array');
  if (!isNonEmptyString(agent.status)) issues.push('status is required');
  if (agent.lease_expires_at != null && typeof agent.lease_expires_at !== 'number') {
    issues.push('lease_expires_at must be a number or null');
  }

  if (issues.length) {
    throw new Error(`Invalid capability lease: ${issues.join('; ')}`);
  }
}
