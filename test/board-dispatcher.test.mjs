import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, MemoryDispatchStore } from '../lib/dispatcher.js';
import { createBoardDispatchService } from '../lib/boardDispatcher.js';

const task = { id: 'board-1', title: 'Build it', description: 'Done means tested', status: 'idle',
  owner: null, required_capability: 'coding', fallback_owner: 'nex', created_at: 1 };
const nex = { id: 'nex', mode: 'permanent', state: 'idle', status: 'online', capabilities: ['coding'] };

function boardSpy() {
  const calls = [];
  const adapter = {};
  for (const name of ['claimTask', 'updateProgress', 'completeTask', 'markBlocked']) {
    adapter[name] = async (input) => { calls.push([name, input]); return input; };
  }
  return { adapter, calls };
}

test('board service mirrors an approved atomic dispatch into board ownership', async () => {
  const store = new MemoryDispatchStore();
  const dispatcher = createDispatcher({ store, listAgentsFn: async () => [nex] });
  const { adapter, calls } = boardSpy();
  const service = createBoardDispatchService({ dispatcher, board: adapter });
  const result = await service.dispatch(task, { approval_state: 'approved' });
  assert.equal(result.status, 'claimed');
  assert.deepEqual(calls[0], ['claimTask', { id: 'board-1', owner: 'nex' }]);
  assert.equal(calls[1][1].status, 'planning');
});

test('board service makes an approval wait visible to Justin', async () => {
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [nex] });
  const { adapter, calls } = boardSpy();
  const service = createBoardDispatchService({ dispatcher, board: adapter });
  const result = await service.dispatch(task);
  assert.equal(result.status, 'pending_approval');
  assert.equal(calls[0][1].status, 'waiting_for_justin');
});

test('board service completes only with the current lease credentials', async () => {
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [nex] });
  const { adapter, calls } = boardSpy();
  const service = createBoardDispatchService({ dispatcher, board: adapter });
  const claimed = await service.dispatch(task, { approval_state: 'approved' });
  const record = await service.complete({ ...task, owner: 'nex' },
    { agentId: 'nex', leaseToken: claimed.record.lease_token }, { ok: true });
  assert.equal(record.state, 'completed');
  assert.equal(calls.at(-1)[0], 'completeTask');
});
