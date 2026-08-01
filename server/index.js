// ============================================================================
// SIGNALING + ICE SERVER
// ----------------------------------------------------------------------------
//  /peerjs   -> PeerJS signaling (WebSocket)
//  /ice      -> Cloudflare Realtime TURN credentials (CORS enabled)
//  /health   -> uptime check
// ============================================================================

const express = require('express');
const { ExpressPeerServer } = require('peer');

const PORT = Number(process.env.PORT || 9000);

// Cloudflare Realtime TURN credentials (set these in the Render dashboard)
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID;
const CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN;

// Restrict to a single origin by setting ALLOWED_ORIGIN, otherwise allow all.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Credentials are minted with a 24h TTL; we re-mint slightly earlier than that.
const CREDENTIAL_TTL_SECONDS = 86400;
const CACHE_LIFETIME_MS = 23 * 60 * 60 * 1000;

// Used whenever Cloudflare is unavailable or unconfigured. STUN-only: direct
// connections still work, but there is no relay fallback.
const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

const app = express();

// ----------------------------------------------------------------------------
// CORS - the game is served from a different origin (GitHub Pages) than this
// API, so /ice would be blocked by the browser without these headers.
// ----------------------------------------------------------------------------
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// ----------------------------------------------------------------------------
// ICE SERVER CREDENTIALS
// ----------------------------------------------------------------------------
let iceCache = { servers: null, fetchedAt: 0 };

async function mintCloudflareIceServers() {
    const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`;

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 8000);

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CF_TURN_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
            signal: controller.signal
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Cloudflare responded ${response.status}: ${body}`);
        }

        const data = await response.json();
        if (!data.iceServers) {
            throw new Error('Cloudflare response missing iceServers');
        }

        // Cloudflare returns a single object or an array depending on the account.
        return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
    } finally {
        clearTimeout(abortTimer);
    }
}

async function getIceServers() {
    if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) {
        return { iceServers: FALLBACK_ICE_SERVERS, source: 'fallback-unconfigured' };
    }

    const cacheAge = Date.now() - iceCache.fetchedAt;
    if (iceCache.servers && cacheAge < CACHE_LIFETIME_MS) {
        return { iceServers: iceCache.servers, source: 'cache' };
    }

    try {
        const servers = await mintCloudflareIceServers();
        iceCache = { servers, fetchedAt: Date.now() };
        console.log('[ICE] Minted fresh Cloudflare TURN credentials');
        return { iceServers: servers, source: 'cloudflare' };
    } catch (err) {
        console.error('[ICE] Failed to mint Cloudflare credentials:', err.message);

        // Prefer stale-but-valid credentials over dropping relay entirely.
        if (iceCache.servers) {
            return { iceServers: iceCache.servers, source: 'stale-cache' };
        }
        return { iceServers: FALLBACK_ICE_SERVERS, source: 'fallback-error' };
    }
}

app.get('/ice', async (req, res) => {
    const { iceServers, source } = await getIceServers();
    const hasRelay = iceServers.some(entry => {
        const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
        return urls.some(url => typeof url === 'string' && url.startsWith('turn'));
    });

    // Browsers may cache this; keep it short so rotated creds propagate.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ iceServers, source, hasRelay });
});

// ----------------------------------------------------------------------------
// HEALTH
// ----------------------------------------------------------------------------
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        turnConfigured: Boolean(CF_TURN_KEY_ID && CF_TURN_API_TOKEN),
        uptimeSeconds: Math.round(process.uptime())
    });
});

// ----------------------------------------------------------------------------
// PEERJS SIGNALING
// ----------------------------------------------------------------------------
const server = app.listen(PORT, () => {
    console.log(`[SERVER] Listening on port ${PORT}`);
    console.log(`[SERVER] TURN configured: ${Boolean(CF_TURN_KEY_ID && CF_TURN_API_TOKEN)}`);
});

const peerServer = ExpressPeerServer(server, {
    path: '/',
    proxied: true,        // Render terminates TLS in front of us
    allow_discovery: false,
    alive_timeout: 60000,
    key: 'peerjs'
});

app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
    console.log(`[PEER] connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
    console.log(`[PEER] disconnected: ${client.getId()}`);
});

peerServer.on('error', (err) => {
    console.error('[PEER] error:', err.message);
});
