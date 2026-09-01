import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgentStatus, chooseAgent, permanentNex } from '../lib/agents.js';

const now = 1_000_000;

test('subscription agents become available on demand after their lease expires', () => {
  const status = computeAgentStatus({ mode: 'subscription_connector', state: 'idle', lease_expires_at: now - 1 }, now);
  assert.equal(status, 'available_on_demand');
});

test('API agents become offline after their lease expires', () => {
  const status = computeAgentStatus({ mode: 'api', state: 'idle', lease_expires_at: now - 1 }, now);
  assert.equal(status, 'offline');
});

test('active lease reports an external agent online', () => {
  const status = computeAgentStatus({ mode: 'subscription_connector', state: 'idle', lease_expires_at: now + 1 }, now);
  assert.equal(status, 'online');
});

test('capability routing prefers requested connected agent and falls back to Nex', () => {
  const nex = permanentNex();
  const claude = { id: 'claude', status: 'available_on_demand', capabilities: ['coding'] };
  const gemini = { id: 'gemini', status: 'available_on_demand', capabilities: ['scouting'] };
  assert.equal(chooseAgent([nex, claude, gemini], 'coding', 'claude').id, 'claude');
  assert.equal(chooseAgent([nex, claude, gemini], 'missing').id, 'nex');
});
