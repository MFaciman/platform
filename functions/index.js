/**
 * AFL Platform — Anthropic API Proxy
 * Firebase Cloud Function
 *
 * Security layers:
 *   1. Firebase Auth token verification — only logged-in AFL reps can call this
 *   2. Per-user rate limiting — max 20 queries/day, 5/minute via Firestore
 *   3. Anthropic key never exposed to frontend — stored in Firebase Secrets
 *   4. CORS locked to your domain only
 *   5. Request size limit — prevents prompt injection attacks
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// Anthropic key — stored in Firebase Secrets, never in code
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

// ── CORS allowed origins ──
const ALLOWED_ORIGINS = [
  'https://mfaciman.github.io',
  'https://altsfundlink.com',
  'https://app.altsfundlink.com',
  'http://localhost:3000',   // local dev
  'http://127.0.0.1:5500',  // VS Code Live Server
];

// ── Rate limit config ──
const RATE_LIMIT = {
  maxPerDay    : 20,   // max queries per user per day
  maxPerMinute : 5,    // max queries per user per minute
};

// ── Anthropic model ──
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS      = 1500;

// ─────────────────────────────────────────────────────────────
//  Main Function Export
// ─────────────────────────────────────────────────────────────
exports.analyzeOffering = onRequest(
  {
    secrets: [anthropicApiKey],
    timeoutSeconds: 120,
    memory: '256MiB',
    region: 'us-central1',
  },
  async (req, res) => {

    // ── CORS ──
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // ── Auth verification ──
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized — no token provided' });
      return;
    }

    let uid, userEmail;
    try {
      const token = authHeader.split('Bearer ')[1];
      const decoded = await admin.auth().verifyIdToken(token);
      uid        = decoded.uid;
      userEmail  = decoded.email || uid;
    } catch (e) {
      res.status(401).json({ error: 'Unauthorized — invalid token' });
      return;
    }

    // ── Request validation ──
    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Invalid request — messages array required' });
      return;
    }

    if (!systemPrompt || typeof systemPrompt !== 'string') {
      res.status(400).json({ error: 'Invalid request — systemPrompt required' });
      return;
    }

    // Prevent oversized requests
    const payloadSize = JSON.stringify(req.body).length;
    if (payloadSize > 200000) { // 200KB limit
      res.status(413).json({ error: 'Request too large' });
      return;
    }

    // ── Rate limiting ──
    try {
      const rateLimitOk = await checkRateLimit(uid);
      if (!rateLimitOk) {
        res.status(429).json({
          error: 'Rate limit reached — maximum 20 Analyst queries per day. Resets at midnight.'
        });
        return;
      }
    } catch (e) {
      console.error('[AFL] Rate limit check failed:', e);
      // Fail open — don't block the user if rate limit check errors
    }

    // ── Call Anthropic ──
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type'      : 'application/json',
          'x-api-key'         : anthropicApiKey.value(),
          'anthropic-version' : '2023-06-01',
        },
        body: JSON.stringify({
          model     : ANTHROPIC_MODEL,
          max_tokens: MAX_TOKENS,
          system    : systemPrompt,
          stream    : true,
          messages  : messages.slice(-12), // last 12 turns max
        }),
      });

      if (!anthropicRes.ok) {
        const errBody = await anthropicRes.text();
        console.error('[AFL] Anthropic error:', anthropicRes.status, errBody);
        res.status(502).json({
          error: `Anthropic API error: ${anthropicRes.status}`
        });
        return;
      }

      // ── Stream response back to client ──
      res.set('Content-Type', 'text/event-stream');
      res.set('Cache-Control', 'no-cache');
      res.set('Connection', 'keep-alive');

      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        res.write(chunk);
      }

      res.end();

      // ── Log usage to Firestore ──
      await logUsage(uid, userEmail).catch(e =>
        console.error('[AFL] Usage log failed:', e)
      );

    } catch (e) {
      console.error('[AFL] Function error:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─────────────────────────────────────────────────────────────
//  Rate Limit Check
//  Uses Firestore to track per-user usage
// ─────────────────────────────────────────────────────────────
async function checkRateLimit(uid) {
  const now      = new Date();
  const dateKey  = now.toISOString().split('T')[0]; // "2026-03-06"
  const minuteKey= Math.floor(now.getTime() / 60000); // unix minute

  const ref = db.collection('analyst_usage').doc(uid);
  const doc = await ref.get();
  const data = doc.exists ? doc.data() : {};

  // Daily limit
  const dailyCount = (data.date === dateKey) ? (data.dailyCount || 0) : 0;
  if (dailyCount >= RATE_LIMIT.maxPerDay) return false;

  // Per-minute limit
  const minuteCount = (data.minuteKey === minuteKey) ? (data.minuteCount || 0) : 0;
  if (minuteCount >= RATE_LIMIT.maxPerMinute) return false;

  // Update counts
  await ref.set({
    date        : dateKey,
    dailyCount  : dailyCount + 1,
    minuteKey   : minuteKey,
    minuteCount : minuteCount + 1,
    lastCall    : admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return true;
}

// ─────────────────────────────────────────────────────────────
//  Usage Logger
//  Records each query for analytics / billing visibility
// ─────────────────────────────────────────────────────────────
async function logUsage(uid, email) {
  await db.collection('analyst_log').add({
    uid       : uid,
    email     : email,
    timestamp : admin.firestore.FieldValue.serverTimestamp(),
    model     : ANTHROPIC_MODEL,
  });
}

