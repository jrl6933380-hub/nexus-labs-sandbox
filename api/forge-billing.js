// /api/forge-billing.js
// POST { action: 'create_checkout_session', tenantId, priceId, successUrl, cancelUrl }
// POST { action: 'get_status', tenantId, customerId }

import { createCheckoutSession, getBillingStatus, isStripeConfigured } from '../lib/forgeBilling.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ stripeConfigured: isStripeConfigured() });
    }

    if (req.method === 'POST') {
      const { action, ...params } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });

      if (action === 'create_checkout_session') {
        const session = await createCheckoutSession(params);
        return res.status(200).json(session);
      }

      if (action === 'get_status') {
        const status = await getBillingStatus(params);
        return res.status(200).json(status);
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('api/forge-billing error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
