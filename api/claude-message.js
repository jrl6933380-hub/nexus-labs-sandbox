// /pages/api/claude-message.js
// A private lane for Claude to message Nex directly — runs through
// the exact same brain as the visible chat (lib/nexBrain.js), but
// stateless: nothing here reads or writes the shared KV conversation
// history, so nothing shows up in Mr. Lopez's dashboard chat. Each
// call is independent. Meant for Claude to test something with Nex
// or send a one-off message, without cluttering the real conversation.

import { initSentry, Sentry } from '../lib/sentry.js';
import { askNex } from '../lib/nexBrain.js';

export default async function handler(req, res) {
  initSentry();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });

  try {
    // No history in, none saved after — fully stateless per call.
    const { reply } = await askNex(message, []);
    return res.status(200).json({ reply });
  } catch (err) {
    console.error('claude-message handler crashed:', err);
    Sentry.captureException(err);
    await Sentry.flush(2000);
    return res.status(500).json({ error: 'Internal system error processing message.' });
  }
}
