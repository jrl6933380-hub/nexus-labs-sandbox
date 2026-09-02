import { createDispatcher, RedisDispatchStore } from '../lib/dispatcher.js';
import { createBoardDispatchService } from '../lib/boardDispatcher.js';
import { listTasks, claimTask, updateProgress, markBlocked, completeTask } from '../lib/board.js';
import { fireClaudeRoutine, createRedisWakeLedger } from '../lib/routineWake.js';

function service() {
  const dispatcher = createDispatcher({ store: new RedisDispatchStore() });
  // Only wired when the routine env vars are actually configured, so
  // this endpoint keeps working (Nex/local dispatch unaffected) before
  // Justin has created the routine at claude.ai/code/routines and set
  // CLAUDE_ROUTINE_FIRE_URL / CLAUDE_ROUTINE_TRIGGER_TOKEN.
  const routineConfigured = process.env.CLAUDE_ROUTINE_FIRE_URL && process.env.CLAUDE_ROUTINE_TRIGGER_TOKEN;
  const wake = routineConfigured
    ? { 'claude-routine': (envelope, record) =>
        fireClaudeRoutine(envelope, { ledger: createRedisWakeLedger() }) }
    : {};
  return createBoardDispatchService({ dispatcher,
    board: { claimTask, updateProgress, markBlocked, completeTask }, wake });
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { action, task_id, envelope_overrides, agent_id, lease_token, result, error, to_agent } = req.body || {};
    if (!action) return res.status(400).json({ error: 'action is required' });
    const dispatch = service();
    if (action === 'recover_expired') return res.status(200).json({ records: await dispatch.recoverExpired() });
    if (!task_id) return res.status(400).json({ error: 'task_id is required' });
    const task = (await listTasks()).find((candidate) => candidate.id === task_id);
    if (!task) return res.status(404).json({ error: `Task not found: ${task_id}` });
    const credentials = { agentId: agent_id, leaseToken: lease_token };

    if (action === 'dispatch') return res.status(200).json(await dispatch.dispatch(task, envelope_overrides));
    if (action === 'heartbeat') return res.status(200).json({ record: await dispatch.heartbeat(task, credentials) });
    if (action === 'complete') return res.status(200).json({ record: await dispatch.complete(task, credentials, result) });
    if (action === 'fail') return res.status(200).json({ record: await dispatch.fail(task, credentials, error) });
    if (action === 'handoff') return res.status(200).json({ record: await dispatch.handoff(task, credentials, to_agent) });
    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('dispatch handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
