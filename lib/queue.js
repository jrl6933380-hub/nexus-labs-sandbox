// /lib/queue.js
// Approval queue — file-writing actions Nex proposes get parked here
// instead of executing immediately. Mr. Lopez approves or rejects
// each one from the dashboard.
//
// Storage: Upstash Redis hash "nex:queue" — field = item id, value =
// JSON string. Same pattern as lib/memory.js.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const QUEUE_KEY = 'nex:queue';

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('queue redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

export async function listQueue() {
  try {
    const raw = await redisCommand(['HGETALL', QUEUE_KEY]);
    if (!raw || !Array.isArray(raw)) return [];
    const items = [];
    for (let i = 0; i < raw.length; i += 2) {
      try {
        items.push(JSON.parse(raw[i + 1]));
      } catch {
        // skip a malformed entry
      }
    }
    items.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    return items;
  } catch (err) {
    console.error('listQueue failed:', err.message);
    return [];
  }
}

export async function addToQueue({ tool, input, description }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = {
    id,
    tool,
    input,
    description: description || `${tool} on ${input?.path || 'unknown file'}`,
    created_at: Date.now(),
  };
  await redisCommand(['HSET', QUEUE_KEY, id, JSON.stringify(item)]);
  return item;
}

export async function getQueueItem(id) {
  const raw = await redisCommand(['HGET', QUEUE_KEY, id]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function removeFromQueue(id) {
  await redisCommand(['HDEL', QUEUE_KEY, id]);
}
