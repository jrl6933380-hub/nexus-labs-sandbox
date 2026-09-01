// /api/agents.js
// Register optional agents, refresh presence leases, and list current workspace capabilities.

import { listAgents, registerAgent, heartbeatAgent, disableAgent } from '../lib/agents.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json({ agents: await listAgents() });
    if (req.method === 'POST') {
      const { action = 'register', ...params } = req.body || {};
      if (action === 'register') return res.status(200).json({ agent: await registerAgent(params) });
      if (action === 'heartbeat') return res.status(200).json({ agent: await heartbeatAgent(params) });
      if (action === 'disable') return res.status(200).json({ agent: await disableAgent(params) });
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }
    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('agents handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
