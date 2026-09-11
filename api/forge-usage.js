// /api/forge-usage.js
// GET  -> current global spend state (+ optional ?tenantId= for that tenant's usage)
// POST -> { action: 'charge', tenantId, amountUsd } to reserve spend against the
//         global ceiling (used by metered actions before committing work), or
//         { action: 'set_ceiling', ceilingUsd } to change the global cap (admin use).

import {
  getGlobalSpendState,
  getTenantUsage,
  chargeSpendUsd,
  setGlobalCeilingUsd,
} from '../lib/forgeUsage.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { tenantId } = req.query || {};
      const global = await getGlobalSpendState();
      const tenantUsage = tenantId ? await getTenantUsage(tenantId) : null;
      return res.status(200).json({ global, tenantUsage });
    }

    if (req.method === 'POST') {
      const { action, ...params } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });

      if (action === 'charge') {
        const result = await chargeSpendUsd(params);
        const status = result.ok ? 200 : 402; // 402 Payment Required when ceiling blocks it
        return res.status(status).json(result);
      }

      if (action === 'set_ceiling') {
        const state = await setGlobalCeilingUsd(params.ceilingUsd);
        return res.status(200).json(state);
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('api/forge-usage error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
