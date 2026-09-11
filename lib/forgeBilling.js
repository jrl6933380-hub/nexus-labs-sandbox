// lib/forgeBilling.js
// Stripe wiring for Nexus Forge hosted billing.
//
// Fails SAFE: if STRIPE_SECRET_KEY isn't set, every function returns a
// clearly-labeled mock response (`mock: true`) instead of throwing, so
// onboarding/dev/sandbox environments work without a real Stripe account.
// Never hardcode a key here — it must come from process.env, and only
// test-mode keys (sk_test_...) should ever be used outside real production.

let _stripeClient = null;
let _stripeLoadAttempted = false;

async function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  if (_stripeClient) return _stripeClient;
  if (_stripeLoadAttempted) return _stripeClient;
  _stripeLoadAttempted = true;
  try {
    const mod = await import('stripe');
    const Stripe = mod.default || mod;
    _stripeClient = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    return _stripeClient;
  } catch (err) {
    console.error('lib/forgeBilling.js: failed to load stripe SDK', err.message);
    return null;
  }
}

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isTestModeKey(key = process.env.STRIPE_SECRET_KEY || '') {
  return !key || key.startsWith('sk_test_');
}

// Creates a Stripe Checkout session for a tenant choosing the hosted plan.
// Falls back to a mock session when Stripe isn't configured, so onboarding
// can be built and tested end to end before real keys exist.
export async function createCheckoutSession({ tenantId, priceId, successUrl, cancelUrl } = {}) {
  if (!tenantId) throw new Error('tenantId is required');

  const client = await getStripeClient();
  if (!client) {
    return {
      mock: true,
      id: `mock_session_${tenantId}_${Date.now()}`,
      url: successUrl || '#mock-checkout',
      tenantId,
      note: 'STRIPE_SECRET_KEY not configured — returning a mock checkout session for local/dev/sandbox use.',
    };
  }

  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    line_items: priceId ? [{ price: priceId, quantity: 1 }] : undefined,
    success_url: successUrl || 'https://nexus.example.com/onboarding?status=success',
    cancel_url: cancelUrl || 'https://nexus.example.com/onboarding?status=cancelled',
    client_reference_id: tenantId,
  });

  return { mock: false, id: session.id, url: session.url, tenantId };
}

// Retrieves current subscription/customer status for a tenant. Mocked the
// same way when Stripe isn't configured.
export async function getBillingStatus({ tenantId, customerId } = {}) {
  if (!tenantId) throw new Error('tenantId is required');

  const client = await getStripeClient();
  if (!client) {
    return {
      mock: true,
      tenantId,
      status: 'none',
      note: 'STRIPE_SECRET_KEY not configured — no real billing status available.',
    };
  }

  if (!customerId) {
    return { mock: false, tenantId, status: 'no_customer' };
  }

  const subs = await client.subscriptions.list({ customer: customerId, limit: 1 });
  const sub = subs.data[0];
  return {
    mock: false,
    tenantId,
    status: sub ? sub.status : 'no_subscription',
    subscriptionId: sub ? sub.id : null,
  };
}
