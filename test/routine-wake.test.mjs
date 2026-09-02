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
  // The /fire endpoint takes a single freeform `text` field — anything
  // else in the body is ignored by the API, so the task pointer has to
  // live inside `text`.
  assert.ok(body.text.includes('task-1'), 'the task_id must be present in the text pointer');
  assert.equal(Object.keys(body).length, 1, 'body should contain only `text`');
  // Must NOT leak full task content — only a reference the woken
  // session uses to look the real task up via the Nexus connector.
  assert.ok(!body.text.includes('acceptance_criteria'));
  assert.equal(body.goal, undefined);
  assert.equal(body.constraints, undefined);
  assert.equal(body.acceptance_criteria, undefined);
});

test('sends the trigger token as a bearer header plus the required beta and version headers, never in the body', async () => {
  const { fetchImpl, calls } = mockFetchOk();
  await fireClaudeRoutine(envelope, {
    fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: 'secret-token-xyz',
    ledger: createMemoryWakeLedger(),
  });
  const headers = calls[0].init.headers;
  assert.equal(headers.Authorization, 'Bearer secret-token-xyz');
  assert.equal(headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.equal(headers['anthropic-version'], '2023-06-01');
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

// --- Regression coverage for the real incident: FIRE_URL/TRIGGER_TOKEN
// swapped in config, and the token leaked into a board task's
// blocked_reason via an unredacted fetch error. ---

test('REGRESSION: a token-shaped value in fireUrl (the swapped-env-vars case) never appears in the thrown error', async () => {
  const tokenShapedValue = 'sk-ant-oat01-EXAMPLE-NOT-A-REAL-TOKEN-used-only-to-prove-it-is-never-echoed';
  const fetchImpl = async () => { throw new Error('should never be called — must fail URL validation first'); };
  await assert.rejects(
    () => fireClaudeRoutine(envelope, { fetchImpl, fireUrl: tokenShapedValue, triggerToken: 'some-token', ledger: createMemoryWakeLedger() }),
    (err) => {
      assert.ok(!err.message.includes(tokenShapedValue), 'the malformed "URL" (actually a token) must never be echoed back');
      assert.ok(err.message.includes('not a valid URL'));
      return true;
    }
  );
});

test('REGRESSION: a genuine network failure redacts the trigger token from the error even if the URL was valid', async () => {
  const secretToken = 'secret-token-that-must-never-appear';
  const fetchImpl = async () => { throw new Error(`connect ECONNREFUSED — while calling with token ${secretToken}`); };
  await assert.rejects(
    () => fireClaudeRoutine(envelope, { fetchImpl, fireUrl: 'https://api.example/fire', triggerToken: secretToken, ledger: createMemoryWakeLedger() }),
    (err) => {
      assert.ok(!err.message.includes(secretToken), 'defense-in-depth redaction must strip the token even from an unrelated network error');
      assert.ok(err.message.includes('[redacted]'));
      return true;
    }
  );
});

test('a non-http(s) fireUrl is rejected before ever reaching fetch', async () => {
  const fetchImpl = async () => { throw new Error('should never be called'); };
  await assert.rejects(
    () => fireClaudeRoutine(envelope, { fetchImpl, fireUrl: 'javascript:alert(1)', triggerToken: 't', ledger: createMemoryWakeLedger() }),
    /must be an http\(s\) URL/
  );
});
