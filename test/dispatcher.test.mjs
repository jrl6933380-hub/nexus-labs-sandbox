import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, chooseDispatchAgent, MemoryDispatchStore } from '../lib/dispatcher.js';

function envelope(overrides = {}) {
  return { schema_version: 1, task_id: 'task-1', tenant_id: 'default', project_id: null,
    goal: 'Build the dispatcher', constraints: [], acceptance_criteria: [],
    required_capabilities: ['coding'], risk_class: 'medium', approval_state: 'approved',
    preferred_agent: null, fallback_agent: 'nex', budget: null, deadline: null, attempt: 1,
    idempotency_key: 'event-1', created_by: 'codex', trace_id: 'trace-1', created_at: 1,
    ...overrides };
}

const nex = { id: 'nex', mode: 'permanent', state: 'idle', status: 'online', cost_tier: 0,
  capabilities: ['coding', 'routing'] };
const claude = { id: 'claude', mode: 'subscription_connector', state: 'idle',
  status: 'available_on_demand', cost_tier: 2, capabilities: ['coding'] };

test('medium and high risk tasks wait for approval', async () => {
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [nex] });
  const result = await dispatcher.dispatch(envelope({ approval_state: 'pending' }));
  assert.equal(result.status, 'pending_approval');
});

test('routing prefers an eligible optional worker before safe Nex fallback', () => {
  assert.equal(chooseDispatchAgent(envelope(), [nex, claude]).agent.id, 'claude');
  assert.equal(chooseDispatchAgent(envelope({ required_capabilities: ['routing'] }), [nex, claude]).agent.id, 'nex');
});

test('cost tier and mode deterministically choose between capable optional workers', () => {
  const api = { ...claude, id: 'api-worker', mode: 'api', cost_tier: 1, status: 'online' };
  const local = { ...claude, id: 'local-worker', mode: 'local', cost_tier: 1, status: 'online' };
  assert.equal(chooseDispatchAgent(envelope(), [nex, api, local]).agent.id, 'local-worker');
});

test('two concurrent workers cannot own one task', async () => {
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude] });
  const [a, b] = await Promise.all([dispatcher.dispatch(envelope()), dispatcher.dispatch(envelope())]);
  assert.deepEqual([a.status, b.status].sort(), ['claimed', 'owned']);
  assert.equal((await store.get('task-1')).owner, 'claude');
});

test('one idempotency key cannot dispatch two different task ids', async () => {
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude] });
  assert.equal((await dispatcher.dispatch(envelope())).status, 'claimed');
  const duplicate = await dispatcher.dispatch(envelope({ task_id: 'task-2', trace_id: 'trace-2' }));
  assert.equal(duplicate.status, 'duplicate');
});

test('expired workers release and the task can be claimed again with a new lease', async () => {
  let clock = 100;
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude], now: () => clock, leaseMs: 10 });
  const first = await dispatcher.dispatch(envelope());
  clock = 111;
  const recovered = await dispatcher.recoverExpired();
  assert.equal(recovered[0].reason, 'lease_expired');
  const second = await dispatcher.dispatch(envelope());
  assert.equal(second.status, 'claimed');
  assert.notEqual(second.record.lease_token, first.record.lease_token);
  assert.equal(second.record.attempts, 2);
});

test('heartbeat rejects stale credentials and extends a valid lease', async () => {
  let clock = 100;
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude], now: () => clock, leaseMs: 10 });
  const claimed = await dispatcher.dispatch(envelope());
  assert.equal(await dispatcher.heartbeat(envelope(), { agentId: 'claude', leaseToken: 'wrong' }), null);
  clock = 105;
  const alive = await dispatcher.heartbeat(envelope(), { agentId: 'claude', leaseToken: claimed.record.lease_token });
  assert.equal(alive.state, 'running');
  assert.equal(alive.lease_expires_at, 115);
});

test('failure backs off exponentially and dead-letters at the attempt limit', async () => {
  let clock = 100;
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude], now: () => clock,
    leaseMs: 10, maxAttempts: 2, backoffMs: 5 });
  const first = await dispatcher.dispatch(envelope());
  let failed = await dispatcher.fail(envelope(), { agentId: 'claude', leaseToken: first.record.lease_token }, 'boom');
  assert.equal(failed.state, 'retry_wait');
  assert.equal(failed.next_retry_at, 105);
  assert.equal((await dispatcher.dispatch(envelope())).status, 'retry_wait');
  clock = 105;
  const second = await dispatcher.dispatch(envelope());
  failed = await dispatcher.fail(envelope(), { agentId: 'claude', leaseToken: second.record.lease_token }, 'boom again');
  assert.equal(failed.state, 'dead_letter');
});

test('safe handoff atomically rotates ownership and invalidates the old lease', async () => {
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [claude] });
  const first = await dispatcher.dispatch(envelope());
  const firstLeaseToken = first.record.lease_token;
  const local = { ...claude, id: 'local-worker', mode: 'local', status: 'online' };
  const handed = await dispatcher.handoff(envelope(), { agentId: 'claude', leaseToken: first.record.lease_token }, local);
  assert.equal(handed.owner, 'local-worker');
  assert.notEqual(handed.lease_token, firstLeaseToken);
  assert.equal(await dispatcher.complete(envelope(), { agentId: 'claude', leaseToken: firstLeaseToken }, 'bad'), null);
});

test('missing optional workers fall back to Nex or remain pending with a clear reason', async () => {
  const store = new MemoryDispatchStore();
  let dispatcher = createDispatcher({ store, listAgentsFn: async () => [nex] });
  assert.equal((await dispatcher.dispatch(envelope())).agent.id, 'nex');
  dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [nex] });
  const pending = await dispatcher.dispatch(envelope({ task_id: 'task-x', idempotency_key: 'event-x',
    required_capabilities: ['payments'] }));
  assert.equal(pending.status, 'pending_agent');
  assert.match(pending.reason, /payments/);
});
