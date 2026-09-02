import { toEnvelope } from './taskEnvelope.js';

export function createBoardDispatchService({ dispatcher, board }) {
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
