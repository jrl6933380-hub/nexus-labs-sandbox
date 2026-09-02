import { listAgents, chooseAgent } from './agents.js';

// /lib/board.js
// Shared task board for Nex plus whichever optional agents are currently
// connected to this workspace — so nobody overwrites someone else's in-progress work blind,
// and everyone can see who's doing what before diving in. This is the
// direct fix for tonight's collision: GPT and Claude both editing
// lib/sandbox.js without knowing about each other's changes.

// Vercel's legacy KV uses KV_REST_*; the current Upstash integration uses\n// UPSTASH_REDIS_REST_*. Support either without copying secrets between stores.\nconst KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;\nconst KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TASKS_KEY = 'nexus:board:tasks';
const MESSAGES_KEY = 'nexus:board:messages';
const MESSAGE_LIMIT = 50;
const VALID_STATUSES = ['idle', 'planning', 'building', 'testing', 'blocked', 'waiting_for_justin', 'complete'];

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing Redis REST URL or token (KV_REST_* or UPSTASH_REDIS_REST_*)');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('board redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function listTasks() {
  const raw = await redisCommand(['HGETALL', TASKS_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const tasks = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      tasks.push(JSON.parse(raw[i + 1]));
    } catch {
      // skip a malformed entry rather than crashing the whole list
    }
  }
  tasks.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  return tasks;
}

export async function createTask({ title, description, owner, required_capability, preferred_agent, fallback_owner = 'nex' }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = {
    id,
    title,
    description: description || '',
    status: owner ? 'planning' : 'idle',
    owner: owner || null,
    required_capability: required_capability || null,
    preferred_agent: preferred_agent || null,
    fallback_owner,
    blocked_reason: null,
    result: null,
    last_note: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  await redisCommand(['HSET', TASKS_KEY, id, JSON.stringify(task)]);
  return task;
}

async function getTask(id) {
  const raw = await redisCommand(['HGET', TASKS_KEY, id]);
  if (!raw) throw new Error(`Task not found: ${id}`);
  return JSON.parse(raw);
}

async function saveTask(task) {
  task.updated_at = Date.now();
  await redisCommand(['HSET', TASKS_KEY, task.id, JSON.stringify(task)]);
  return task;
}

export async function claimTask({ id, owner }) {
  const task = await getTask(id);
  if (!owner) {
    const agents = await listAgents();
    owner = chooseAgent(agents, task.required_capability, task.preferred_agent)?.id || task.fallback_owner || 'nex';
  }
  task.owner = owner;
  if (task.status === 'idle') task.status = 'planning';
  return saveTask(task);
}

export async function updateProgress({ id, status, note }) {
  const task = await getTask(id);
  if (status) {
    if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    task.status = status;
  }
  if (note) task.last_note = note;
  return saveTask(task);
}

export async function markBlocked({ id, reason }) {
  const task = await getTask(id);
  task.status = 'blocked';
  task.blocked_reason = reason;
  return saveTask(task);
}

export async function attachResult({ id, result }) {
  const task = await getTask(id);
  task.result = result;
  return saveTask(task);
}

export async function completeTask({ id, result }) {
  const task = await getTask(id);
  task.status = 'complete';
  if (result) task.result = result;
  return saveTask(task);
}

export async function postMessage({ from, message }) {
  const entry = { from, message, at: Date.now() };
  await redisCommand(['LPUSH', MESSAGES_KEY, JSON.stringify(entry)]);
  await redisCommand(['LTRIM', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  return entry;
}

export async function listMessages() {
  const raw = await redisCommand(['LRANGE', MESSAGES_KEY, '0', String(MESSAGE_LIMIT - 1)]);
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((r) => {
    try {
      return JSON.parse(r);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function readBoard() {
  const [tasks, messages, agents] = await Promise.all([listTasks(), listMessages(), listAgents()]);
  return { tasks, messages, agents };
}
