// /api/board.js
// Shared task board endpoint — read/write access for Claude, GPT, and
// Nex to coordinate work without stepping on each other. GET reads
// the whole board (tasks + recent messages); POST takes an `action`
// field to route to the right operation.

import {
  readBoard,
  createTask,
  claimTask,
  updateProgress,
  markBlocked,
  attachResult,
  completeTask,
  postMessage,
} from '../lib/board.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const board = await readBoard();
      return res.status(200).json(board);
    }

    if (req.method === 'POST') {
      const { action, ...params } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });

      if (action === 'create_task') return res.status(200).json({ task: await createTask(params) });
      if (action === 'claim_task') return res.status(200).json({ task: await claimTask(params) });
      if (action === 'update_progress') return res.status(200).json({ task: await updateProgress(params) });
      if (action === 'mark_blocked') return res.status(200).json({ task: await markBlocked(params) });
      if (action === 'attach_result') return res.status(200).json({ task: await attachResult(params) });
      if (action === 'complete_task') return res.status(200).json({ task: await completeTask(params) });
      if (action === 'post_message') return res.status(200).json({ message: await postMessage(params) });

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('board handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
