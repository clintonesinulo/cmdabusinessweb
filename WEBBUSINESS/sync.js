/**
 * CMDA-NAUTH Sync API
 * Vercel Serverless Function — acts as the store database backend.
 *
 * Uses Vercel KV (free on hobby plan) for persistent storage across all devices.
 * Falls back to a simple in-memory store if KV is not configured yet.
 *
 * SETUP (one-time, takes 2 minutes):
 * 1. Deploy this project to Vercel (drag & drop the folder)
 * 2. In Vercel dashboard → Storage → Create KV Database → link to project
 * 3. Redeploy — sync is now fully persistent forever
 *
 * WITHOUT KV: still works, but data resets on server cold-start (every ~10min idle)
 * WITH KV:    data persists forever, survives restarts, works across all regions
 */

// ── In-memory fallback (used if Vercel KV not configured) ──────────────────
const memStore = {};

// ── Vercel KV client (auto-available when KV is linked in Vercel dashboard) ─
let kv = null;
try {
    const kvModule = await import('@vercel/kv');
    kv = kvModule.kv;
} catch (e) {
    // KV not configured — using in-memory fallback
}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function kvGet(id) {
    if (kv) return await kv.get(`store:${id}`);
    return memStore[id] || null;
}

async function kvSet(id, data) {
    if (kv) {
        await kv.set(`store:${id}`, data, { ex: 60 * 60 * 24 * 365 }); // 1 year TTL
    } else {
        memStore[id] = data;
    }
}

// ── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // CORS — allow requests from any origin (needed for cross-device access)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // ── GET: read store data ───────────────────────────────────────────
        if (req.method === 'GET') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await kvGet(id);
            if (!data) return res.status(404).json({ error: 'Store not found' });

            return res.status(200).json({ id, data });
        }

        // ── POST: create new store ─────────────────────────────────────────
        if (req.method === 'POST') {
            const body = req.body;
            if (!body || body.action !== 'create') {
                return res.status(400).json({ error: 'Invalid request' });
            }

            const id = generateId();
            await kvSet(id, body.data || {});

            return res.status(201).json({ id, created: true });
        }

        // ── PUT: update store data ─────────────────────────────────────────
        if (req.method === 'PUT') {
            const { id, data } = req.body || {};
            if (!id) return res.status(400).json({ error: 'Missing id' });

            const existing = await kvGet(id);
            if (!existing) return res.status(404).json({ error: 'Store not found' });

            await kvSet(id, data);
            return res.status(200).json({ id, updated: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (err) {
        console.error('Sync API error:', err);
        return res.status(500).json({ error: 'Server error', message: err.message });
    }
}
