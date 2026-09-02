import test from 'node:test';
import assert from 'node:assert/strict';
import { fireClaudeRoutine, createMemoryWakeLedger } from '../lib/routineWake.js';

const envelope = {
  task_id: 'task-1',
  trace_id: 'task-1',
  tenant_id: 'default',
  idempotency_key: 'idem-1',
};

function mockFetchOk() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        type: 'routine_fire',
        claude_code_session_id: 'session_ABC123',
        claude_code_session_url: 'https://claude.ai/code/session_ABC123',
      }),
    };
  };
  return { fetchImpl, calls };
}

test('fires the routine with a minimal untrusted payload, not full task instructions', async () => {
  const { fetchImpl, calls } = mockFetchOk();
  const result = await fireClaudeRoutine(envelope, {
    fetchImpl,
    fireUrl: 'https://api.example/fire',
    triggerToken: 'secret-token-xyz',
    ledger: createMemoryWakeLedger(),
  });

  assert.equal(result.session_id, 'session_ABC123');
  assert.equal(result.session_url, 'https://claude.ai/code/session_ABC123');
  assert.equal(result.replayed, false);

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.task_id, 'task-1');
  assert.equal(body.trace_id, 'task-1');
  // Must NOT leak full task content — only a reference the woken
  // session uses to look the real task up via the Nexus connector.
  assert.equal(body.goal, undefined);
  assert.equal(body.constraints, undefined);
  assert.equal(body.acceptance_criteria, undefined);
});

test('sends the trigger token as a bearer header and the required beta header, never in the body', async () => {
  const { fetchImpl, calls } = mockFetchOk();
  await fireClaudeRoutine(envelope, {
    fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: 'secret-token-xyz',
    ledger: createMemoryWakeLedger(),
  });
  const headers = calls[0].init.headers;
  assert.equal(headers.Authorization, 'Bearer secret-token-xyz');
  assert.equal(headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  const body = JSON.stringify(JSON.parse(calls[0].init.body));
  assert.ok(!body.includes('secret-token-xyz'), 'token must never appear in the request body');
});

test('a replayed dispatch with the same idempotency_key reuses the session instead of firing twice', async () => {
  const { fetchImpl, calls } = mockFetchOk();
  const ledger = createMemoryWakeLedger();
  const first = await fireClaudeRoutine(envelope, { fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: 't', ledger });
  const second = await fireClaudeRoutine(envelope, { fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: 't', ledger });

  assert.equal(calls.length, 1, 'fetch should only be called once — the second call must be a replay hit');
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.session_id, first.session_id);
});

test('a rejected fire throws without leaking the trigger token in the error message', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid token' } }) });
  await assert.rejects(
    () => fireClaudeRoutine(envelope, { fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: 'secret-token-xyz', ledger: createMemoryWakeLedger() }),
    (err) => {
      assert.ok(err.message.includes('invalid token'));
      assert.ok(!err.message.includes('secret-token-xyz'));
      return true;
    }
  );
});

test('missing env vars fail loudly rather than firing with an undefined URL/token', async () => {
  const originalUrl = process.env.CLAUDE_ROUTINE_FIRE_URL;
  const originalToken = process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN;
  delete process.env.CLAUDE_ROUTINE_FIRE_URL;
  delete process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN;
  try {
    await assert.rejects(
      () => fireClaudeRoutine(envelope, { ledger: createMemoryWakeLedger() }),
      /Missing required env var/
    );
  } finally {
    if (originalUrl) process.env.CLAUDE_ROUTINE_FIRE_URL = originalUrl;
    if (originalToken) process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN = originalToken;
  }
});
