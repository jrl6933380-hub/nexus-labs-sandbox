// lib/forgeUsage.js
// Nexus Forge usage tracking + global spend ceiling enforcement.
//
// This is server-side and REAL, not a UI decoration: it uses the same
// Upstash REST KV store lib/board.js already talks to, via atomic Redis
// INCRBYFLOAT, so the ceiling actually holds across concurrent serverless
// invocations instead of resetting per cold start (an in-memory Map would
// NOT survive that — Vercel functions are stateless per instance).

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const GLOBAL_SPEND_KEY = 'nexus:forge:global_spend_usd';
const GLOBAL_CEILING_KEY = 'nexus:forge:global_ceiling_usd';
const TENANT_USAGE_PREFIX = 'nexus:forge:tenant_usage:';
const DEFAULT_GLOBAL_CEILING_USD = 1000; // prototype default, overridable via KV or env

export class SpendCeilingExceededError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'SpendCeilingExceededError';
    this.state = state;
  }
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('forgeUsage redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

async function getCeilingUsd() {
  const raw = await redisCommand(['GET', GLOBAL_CEILING_KEY]);
  if (raw === null || raw === undefined) return DEFAULT_GLOBAL_CEILING_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_CEILING_USD;
}

export async function setGlobalCeilingUsd(ceilingUsd) {
  const v = Number(ceilingUsd);
  if (!Number.isFinite(v) || v < 0) throw new Error('Invalid ceilingUsd');
  await redisCommand(['SET', GLOBAL_CEILING_KEY, String(v)]);
  return getGlobalSpendState();
}

export async function getGlobalSpendState() {
  const [rawSpent, ceilingUsd] = await Promise.all([
    redisCommand(['GET', GLOBAL_SPEND_KEY]),
    getCeilingUsd(),
  ]);
  const spentUsd = rawSpent ? Number(rawSpent) : 0;
  const remainingUsd = Math.max(0, ceilingUsd - spentUsd);
  return {
    spentUsd,
    ceilingUsd,
    remainingUsd,
    percentUsed: computeUsagePercent(ceilingUsd, spentUsd),
    blocked: spentUsd >= ceilingUsd,
  };
}

export async function getTenantUsage(tenantId = 'default') {
  const key = TENANT_USAGE_PREFIX + String(tenantId || 'default');
  const raw = await redisCommand(['GET', key]);
  return { tenantId: String(tenantId || 'default'), usedUsd: raw ? Number(raw) : 0 };
}

// Atomically reserve amountUsd against the global ceiling. Uses an
// increment-then-check-and-compensate pattern: the increment is atomic in
// Redis, so a burst of concurrent calls can't blow past the ceiling by more
// than one in-flight request's worth — same tradeoff most rate limiters
// make rather than requiring a distributed lock for a prototype.
export async function chargeSpendUsd({ tenantId = 'default', amountUsd }) {
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt < 0) throw new Error('Invalid amountUsd');
  if (amt === 0) return { ok: true, ...(await getGlobalSpendState()), tenantUsage: await getTenantUsage(tenantId) };

  const ceilingUsd = await getCeilingUsd();
  const newTotalRaw = await redisCommand(['INCRBYFLOAT', GLOBAL_SPEND_KEY, String(amt)]);
  const newTotal = Number(newTotalRaw);

  if (newTotal > ceilingUsd) {
    // Compensate: roll back this reservation, then refuse the spend.
    await redisCommand(['INCRBYFLOAT', GLOBAL_SPEND_KEY, String(-amt)]);
    const state = await getGlobalSpendState();
    return { ok: false, reason: 'global_ceiling_exceeded', ...state };
  }

  const tenantKey = TENANT_USAGE_PREFIX + String(tenantId || 'default');
  await redisCommand(['INCRBYFLOAT', tenantKey, String(amt)]);

  const remainingUsd = Math.max(0, ceilingUsd - newTotal);
  return {
    ok: true,
    spentUsd: newTotal,
    ceilingUsd,
    remainingUsd,
    percentUsed: computeUsagePercent(ceilingUsd, newTotal),
    blocked: newTotal >= ceilingUsd,
    tenantUsage: await getTenantUsage(tenantId),
  };
}

// Testing/admin escape hatch — never expose over an unauthenticated route.
export async function resetPrototypeUsage() {
  await redisCommand(['SET', GLOBAL_SPEND_KEY, '0']);
  return getGlobalSpendState();
}

export function computeUsagePercent(ceilingUsd, usedUsd) {
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) return 0;
  const pct = (usedUsd / ceilingUsd) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}
