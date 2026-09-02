#!/usr/bin/env node
// One-time setup script for epic task 03. Run this AFTER:
//   1. Creating a routine at https://claude.ai/code/routines (API trigger),
//      giving it access to the Nexus MCP connector.
//   2. Setting CLAUDE_ROUTINE_FIRE_URL and CLAUDE_ROUTINE_TRIGGER_TOKEN
//      in Vercel's Production+Preview env (server-side only — never in
//      client code, never committed).
// This script just registers the 'claude-routine' agent record so the
// dispatcher (lib/dispatcher.js) can select it via chooseDispatchAgent().
// Safe to re-run — registerAgent() overwrites the existing record.
//
// Usage: node scripts/register-claude-routine-agent.mjs

import { registerAgent } from '../lib/agents.js';

const REQUIRED = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'];
for (const name of REQUIRED) {
  if (!process.env[name]) {
    console.error(`Missing ${name} — run this against the same environment the dispatcher uses.`);
    process.exit(1);
  }
}

const agent = await registerAgent({
  id: 'claude-routine',
  provider: 'anthropic',
  display_name: 'Claude (Routine)',
  model_type: 'coding',
  mode: 'subscription_connector',
  capabilities: ['coding', 'review', 'planning'],
  // Long lease: this agent is 'available_on_demand' whenever the routine
  // exists, not something that needs frequent re-heartbeating like a
  // live local worker would.
  lease_ms: 60 * 60 * 1000,
});

console.log('Registered agent:', JSON.stringify(agent, null, 2));
