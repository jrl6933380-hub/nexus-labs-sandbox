// lib/forgeUsage.js
// Minimal usage + spend ceiling enforcement primitives for Nexus Forge.

const DEFAULT_GLOBAL_CEILING = 1000; // USD, placeholder for prototype

function nowMs() {
  return Date.now();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// In the prototype we keep usage in-memory for a single server process.
// In production this must be backed by KV/DB and updated by metering events.
let _global = {
  ceilingUsd: DEFAULT_GLOBAL_CEILING,
  spentUsd: 0,
};

let _tenants = new Map(); // tenantId -> { usedUsd, lastUpdatedMs }

export function getGlobalSpendState() {
  return {
    ceilingUsd: _global.ceilingUsd,
    spentUsd: _global.spentUsd,
    remainingUsd: Math.max(0, _global.ceilingUsd - _global.spentUsd),
  };
}

export function setGlobalCeilingUsd(ceilingUsd) {
  const v = Number(ceilingUsd);
  if (!Number.isFinite(v) || v < 0) throw new Error('Invalid ceilingUsd');
  _global.ceilingUsd = v;
  return getGlobalSpendState();
}

export function getTenantUsage(tenantId = 'default') {
  const key = String(tenantId || 'default');
  const t = _tenants.get(key) || { usedUsd: 0, lastUpdatedMs: 0 };
  return { tenantId: key, usedUsd: t.usedUsd, lastUpdatedMs: t.lastUpdatedMs };
}

export function canSpendUsd(amountUsd) {
  const remaining = _global.ceilingUsd - _global.spentUsd;
  return amountUsd <= remaining;
}

export function chargeSpendUsd({ tenantId = 'default', amountUsd }) {
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt < 0) throw new Error('Invalid amountUsd');

  // Hard cap: once remaining is zero, nobody spends.
  if (!canSpendUsd(amt)) {
    return {
      ok: false,
      reason: 'global_ceiling_exceeded',
      ...getGlobalSpendState(),
    };
  }

  const key = String(tenantId || 'default');
  const t = _tenants.get(key) || { usedUsd: 0, lastUpdatedMs: 0 };
  t.usedUsd += amt;
  t.lastUpdatedMs = nowMs();
  _tenants.set(key, t);

  _global.spentUsd += amt;

  return {
    ok: true,
    ...getGlobalSpendState(),
    tenantUsage: getTenantUsage(key),
  };
}

export function resetPrototypeUsage() {
  _global.spentUsd = 0;
  _tenants = new Map();
  return getGlobalSpendState();
}

export function computeUsagePercent(ceilingUsd, usedUsd) {
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) return 0;
  return clamp((usedUsd / ceilingUsd) * 100, 0, 100);
}
