import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher, MemoryDispatchStore } from '../lib/dispatcher.js';
import { createBoardDispatchService } from '../lib/boardDispatcher.js';

const task = { id: 'board-9', title: 'Investigate the alert', description: 'Root-cause it', status: 'idle',
  owner: null, required_capability: 'coding', preferred_agent: 'claude-routine', fallback_owner: 'nex', created_at: 1 };
const claudeRoutine = { id: 'claude-routine', mode: 'subscription_connector', state: 'idle',
  status: 'available_on_demand', capabilities: ['coding'] };

function boardSpy() {
  const calls = [];
  const adapter = {};
  for (const name of ['claimTask', 'updateProgress', 'completeTask', 'markBlocked']) {
    adapter[name] = async (input) => { calls.push([name, input]); return input; };
  }
  return { adapter, calls };
}

test('a successful wake posts the session URL to the board, not the token', async () => {
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [claudeRoutine] });
  const { adapter, calls } = boardSpy();
  const wake = { 'claude-routine': async () => ({ session_id: 's1', session_url: 'https://claude.ai/code/s1', replayed: false }) };
  const service = createBoardDispatchService({ dispatcher, board: adapter, wake });

  const result = await service.dispatch(task, { approval_state: 'approved' });

  assert.equal(result.status, 'claimed');
  assert.equal(result.wake.session_url, 'https://claude.ai/code/s1');
  const noteCalls = calls.filter(([name]) => name === 'updateProgress').map(([, input]) => input.note);
  assert.ok(noteCalls.some((note) => note.includes('https://claude.ai/code/s1')));
  assert.ok(calls.every(([, input]) => !JSON.stringify(input).match(/token|secret/i)));
});

test('a failed wake marks the task blocked instead of leaving it silently claimed', async () => {
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [claudeRoutine] });
  const { adapter, calls } = boardSpy();
  const wake = { 'claude-routine': async () => { throw new Error('Claude Routine fire rejected: invalid token'); } };
  const service = createBoardDispatchService({ dispatcher, board: adapter, wake });

  const result = await service.dispatch(task, { approval_state: 'approved' });

  assert.equal(result.status, 'claimed');
  assert.ok(result.wake_error.includes('invalid token'));
  const blocked = calls.find(([name]) => name === 'markBlocked');
  assert.ok(blocked, 'markBlocked should have been called');
  assert.ok(blocked[1].reason.includes('Wake failed for claude-routine'));
});

test('an agent with no wake entry (e.g. Nex) is claimed exactly as before, unaffected', async () => {
  const nex = { id: 'nex', mode: 'permanent', state: 'idle', status: 'online', capabilities: ['coding'] };
  const dispatcher = createDispatcher({ store: new MemoryDispatchStore(), listAgentsFn: async () => [nex] });
  const { adapter, calls } = boardSpy();
  const service = createBoardDispatchService({ dispatcher, board: adapter, wake: { 'claude-routine': async () => { throw new Error('should never be called'); } } });

  const result = await service.dispatch({ ...task, preferred_agent: null }, { approval_state: 'approved' });

  assert.equal(result.status, 'claimed');
  assert.equal(result.record.owner, 'nex');
  assert.equal(calls.filter(([name]) => name === 'markBlocked').length, 0);
});
