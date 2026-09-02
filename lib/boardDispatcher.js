import { toEnvelope } from './taskEnvelope.js';

// `wake` is an optional map of agent id -> async (envelope, record) =>
// { session_id, session_url }. Kept generic on purpose: task 03 wires
// in fireClaudeRoutine for 'claude-routine' here in api/dispatch.js,
// and task 04 (ChatGPT wake relay) will add its own entry the same
// way, without this file needing to know anything provider-specific.
// An agent with no entry in `wake` (e.g. Nex, permanent/local workers)
// is claimed exactly as before — nothing to wake, nothing changes.
export function createBoardDispatchService({ dispatcher, board, wake = {} }) {
  if (!dispatcher || !board) throw new Error('dispatcher and board adapters are required');

  const makeEnvelope = (task, overrides = {}) => toEnvelope(task, {
    required_capabilities: task.required_capability ? [task.required_capability] : [],
    preferred_agent: task.preferred_agent || task.owner || null,
    fallback_agent: task.fallback_owner || 'nex',
    ...overrides,
  });

  return {
    async dispatch(task, overrides = {}) {
      const envelope = makeEnvelope(task, overrides);
      const result = await dispatcher.dispatch(envelope);
      if (result.status === 'claimed') {
        await board.claimTask({ id: task.id, owner: result.record.owner });
        await board.updateProgress({ id: task.id, status: 'planning',
          note: `Dispatcher lease assigned to ${result.record.owner}; attempt ${result.record.attempts}` });

        const wakeFn = wake[result.record.owner];
        if (wakeFn) {
          try {
            const woken = await wakeFn(envelope, result.record);
            const replayNote = woken.replayed ? ' (replay — reused existing session, did not fire twice)' : '';
            await board.updateProgress({ id: task.id, status: 'building',
              note: `Woke ${result.record.owner}: ${woken.session_url}${replayNote}` });
            return { envelope, ...result, wake: woken };
          } catch (err) {
            // A claimed-but-never-actually-woken task is worse than a
            // visibly blocked one — surface the failure rather than
            // leaving it silently sitting in 'planning' forever. The
            // error message from routineWake.js never contains the
            // trigger token, so this is safe to write to the board.
            await board.markBlocked({ id: task.id, reason: `Wake failed for ${result.record.owner}: ${err.message}` });
            return { envelope, ...result, wake_error: err.message };
          }
        }
      } else if (result.status === 'pending_approval') {
        await board.updateProgress({ id: task.id, status: 'waiting_for_justin', note: result.reason });
      } else if (result.status === 'pending_agent') {
        await board.updateProgress({ id: task.id, status: 'idle', note: result.reason });
      }
      return { envelope, ...result };
    },

    async heartbeat(task, credentials) {
      const envelope = makeEnvelope(task, { approval_state: 'approved' });
      const record = await dispatcher.heartbeat(envelope, credentials);
      if (record) await board.updateProgress({ id: task.id, status: 'building', note: `Lease heartbeat from ${record.owner}` });
      return record;
    },

    async complete(task, credentials, result) {
      const envelope = makeEnvelope(task, { approval_state: 'approved' });
      const record = await dispatcher.complete(envelope, credentials, result);
      if (record) await board.completeTask({ id: task.id, result });
      return record;
    },

    async fail(task, credentials, error) {
      const envelope = makeEnvelope(task, { approval_state: 'approved' });
      const record = await dispatcher.fail(envelope, credentials, error);
      if (!record) return null;
      if (record.state === 'dead_letter') {
        await board.markBlocked({ id: task.id, reason: `Dead letter after ${record.attempts} attempts: ${error}` });
      } else {
        await board.updateProgress({ id: task.id, status: 'idle',
          note: `Retry scheduled for ${new Date(record.next_retry_at).toISOString()}: ${error}` });
      }
      return record;
    },

    async handoff(task, credentials, toAgent) {
      const envelope = makeEnvelope(task, { approval_state: 'approved' });
      const record = await dispatcher.handoff(envelope, credentials, toAgent);
      if (record) {
        await board.claimTask({ id: task.id, owner: record.owner });
        await board.updateProgress({ id: task.id, status: 'building', note: `Safe handoff to ${record.owner}` });
      }
      return record;
    },

    async recoverExpired() {
      const records = await dispatcher.recoverExpired();
      for (const record of records) {
        await board.updateProgress({ id: record.task_id, status: 'idle',
          note: 'Worker lease expired; task released for safe retry' });
      }
      return records;
    },
  };
}
