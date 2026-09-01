// /api/queue.js
// Approval queue endpoint — the dashboard reads pending items here,
// and Approve/Reject buttons post back to this same endpoint.

import { listQueue, getQueueItem, removeFromQueue } from '../lib/queue.js';
import { createOrUpdateFile, deleteFile, createRepo, deleteRepo, commitFiles } from '../lib/github.js';

async function executeQueuedItem(item) {
  if (item.tool === 'create_repo_file' || item.tool === 'update_repo_file') {
    return createOrUpdateFile(item.input);
  }
  if (item.tool === 'delete_repo_file') {
    return deleteFile(item.input);
  }
  if (item.tool === 'create_repo') {
    return createRepo(item.input);
  }
  if (item.tool === 'delete_repo') {
    return deleteRepo(item.input);
  }
  if (item.tool === 'commit_repo_files') {
    return commitFiles(item.input);
  }
  throw new Error(`Unknown queued tool: ${item.tool}`);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const items = await listQueue();
      return res.status(200).json({ items });
    }

    if (req.method === 'POST') {
      const { id, action } = req.body || {};
      if (!id || !action) return res.status(400).json({ error: 'Missing id or action' });

      const item = await getQueueItem(id);
      if (!item) return res.status(404).json({ error: 'Queue item not found (may already be handled)' });

      if (action === 'reject') {
        await removeFromQueue(id);
        return res.status(200).json({ rejected: true, id });
      }

      if (action === 'approve') {
        try {
          const result = await executeQueuedItem(item);
          await removeFromQueue(id);
          return res.status(200).json({ approved: true, id, result });
        } catch (err) {
          console.error('queue approve execution failed:', err.message);
          // leave it in the queue so Mr. Lopez can see it failed and retry/reject
          return res.status(500).json({ error: `Action failed when executed: ${err.message}` });
        }
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('queue handler crashed:', err.message);
    return res.status(500).json({ error: 'Internal error handling queue request.' });
  }
}
