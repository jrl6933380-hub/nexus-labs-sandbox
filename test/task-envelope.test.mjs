import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTaskEnvelope,
  validateTaskEnvelope,
  assertSameTenant,
  createEvent,
  validateEvent,
  toEnvelope,
  validateCapabilityLease,
  SCHEMA_VERSION,
  RISK_CLASSES,
} from '../lib/taskEnvelope.js';

test('createTaskEnvelope fills defaults and produces a valid envelope from just a goal', () => {
  const envelope = createTaskEnvelope({ goal: 'Fix the mobile nav overlap' });
  assert.equal(envelope.goal, 'Fix the mobile nav overlap');
  assert.equal(envelope.schema_version, SCHEMA_VERSION);
  assert.equal(envelope.tenant_id, 'default');
  assert.equal(envelope.risk_class, 'medium');
  assert.equal(envelope.approval_state, 'pending');
  assert.equal(envelope.attempt, 1);
  assert.ok(envelope.task_id);
  assert.equal(envelope.trace_id, envelope.task_id);
  assert.equal(envelope.idempotency_key, envelope.task_id);
  assert.doesNotThrow(() => validateTaskEnvelope(envelope));
});

test('createTaskEnvelope respects explicit overrides', () => {
  const envelope = createTaskEnvelope({
    goal: 'Add Stripe checkout',
    required_capabilities: ['coding', 'payments'],
    risk_class: 'high',
    preferred_agent: 'claude',
    budget: 5,
  });
  assert.deepEqual(envelope.required_capabilities, ['coding', 'payments']);
  assert.equal(envelope.risk_class, 'high');
  assert.equal(envelope.preferred_agent, 'claude');
  assert.equal(envelope.budget, 5);
});

test('validateTaskEnvelope rejects a malformed payload with every issue listed', () => {
  assert.throws(
    () => validateTaskEnvelope({ schema_version: SCHEMA_VERSION, task_id: 't1', tenant_id: 'default', goal: '', constraints: [], acceptance_criteria: [], required_capabilities: [], risk_class: 'extreme', approval_state: 'pending', attempt: 1, idempotency_key: 't1', created_by: 'x', trace_id: 't1' }),
    /goal is required/
  );
  assert.throws(
    () => validateTaskEnvelope({ schema_version: SCHEMA_VERSION, task_id: 't1', tenant_id: 'default', goal: 'ok', constraints: [], acceptance_criteria: [], required_capabilities: [], risk_class: 'extreme', approval_state: 'pending', attempt: 1, idempotency_key: 't1', created_by: 'x', trace_id: 't1' }),
    /risk_class must be one of/
  );
});

test('createTaskEnvelope throws instead of silently accepting an invalid risk_class', () => {
  assert.throws(() => createTaskEnvelope({ goal: 'x', risk_class: 'catastrophic' }));
  assert.ok(!RISK_CLASSES.includes('catastrophic'));
});

test('assertSameTenant passes for matching tenants and throws across tenants', () => {
  const a = createTaskEnvelope({ goal: 'a', tenant_id: 'acme' });
  const b = createTaskEnvelope({ goal: 'b', tenant_id: 'acme' });
  const c = createTaskEnvelope({ goal: 'c', tenant_id: 'globex' });
  assert.doesNotThrow(() => assertSameTenant(a, b));
  assert.throws(() => assertSameTenant(a, c), /Cross-tenant operation rejected/);
});

test('createEvent produces a valid event carrying the envelope trace_id', () => {
  const envelope = createTaskEnvelope({ goal: 'ship the thing' });
  const event = createEvent('claimed', envelope, { agent_id: 'claude' });
  assert.equal(event.task_id, envelope.task_id);
  assert.equal(event.trace_id, envelope.trace_id);
  assert.deepEqual(event.data, { agent_id: 'claude' });
  assert.doesNotThrow(() => validateEvent(event));
});

test('validateEvent rejects an unknown event type', () => {
  assert.throws(
    () => validateEvent({ type: 'teleported', task_id: 't1', tenant_id: 'default', trace_id: 't1', at: Date.now() }),
    /type must be one of/
  );
});

test('toEnvelope migrates an old board.js task without losing its id, so old tasks remain readable', () => {
  const oldBoardTask = {
    id: '1788248690862-uz6i1r',
    title: 'Memory overhaul: tagged + searchable retrieval for Nex',
    description: 'Add tagged, searchable memory retrieval so Nex only pulls relevant memories per message.',
    status: 'complete',
    owner: 'chatgpt',
    created_at: 1788248690862,
  };
  const envelope = toEnvelope(oldBoardTask);
  assert.equal(envelope.task_id, oldBoardTask.id);
  assert.equal(envelope.goal, oldBoardTask.title);
  assert.equal(envelope.preferred_agent, 'chatgpt');
  assert.equal(envelope.approval_state, 'approved');
  assert.equal(envelope.created_by, 'legacy-board');
  assert.doesNotThrow(() => validateTaskEnvelope(envelope));
});

test('toEnvelope still produces a valid envelope for an unclaimed, description-less task', () => {
  const minimalOldTask = { id: 'abc123', title: 'Do a thing', status: 'idle', owner: null, created_at: Date.now() };
  const envelope = toEnvelope(minimalOldTask);
  assert.equal(envelope.approval_state, 'pending');
  assert.equal(envelope.preferred_agent, null);
  assert.deepEqual(envelope.acceptance_criteria, []);
});

test('validateCapabilityLease accepts a well-formed agent record and rejects a malformed one', () => {
  assert.doesNotThrow(() =>
    validateCapabilityLease({ id: 'claude', capabilities: ['coding'], status: 'online', lease_expires_at: null })
  );
  assert.throws(() => validateCapabilityLease({ id: 'claude', capabilities: 'not-an-array', status: 'online' }));
  assert.throws(() => validateCapabilityLease({ capabilities: [], status: 'online' }));
});
