// ============================================================================
// NETWORK CORE - Peer initialization and connection management
// ============================================================================

import { gameState, MAX_PLAYERS, registerPlayer, removePlayer } from '../gameState.js';
import { renderConsole } from '../console.js';
import { spawnSingleShip, despawnShip } from '../fleetManager.js';
import {
    startHostHeartbeat,
    startClientHeartbeat,
    stopHeartbeat,
    setHeartbeatDependencies,
    getClientLastPong,
    getLatencyMs
} from './networkHeartbeat.js';
import {
    handleHostDisconnect,
    promoteToHost,
    getJoinOrder,
    setJoinOrder,
    addToJoinOrder,
    removeFromJoinOrder,
    initJoinOrder,
    prependToJoinOrder,
    setMigrationDependencies
} from './networkMigration.js';
import {
    isValidMessage,
    handleMessageData,
    setMessageDependencies
} from './networkMessages.js';
import { setCannonWeaponDependencies } from '../weapons/cannonWeapon.js';
import { globalBeamPool } from '../weapons/beamVisuals.js';
import { globalSparkPool } from '../particleEffects.js';
import { createAsteroidSnapshot, ensureAsteroidField } from '../asteroidGenerator.js';

// ============================================================================
// CORE STATE
// ============================================================================
export let peer = null;        // The PeerJS peer instance for both Host and Client modes
export let connection = null;  // Used by CLIENTS (Single line to Host)
export let connections = [];   // Used by the HOST (Array of all connected clients)

let logFeedback = null;
let logChat = null;
let onNetworkDisconnectCallback = null;
let connectionTimeout = null;
let intentionalDisconnect = false;  // Flag: skip host migration when user intentionally quits
let gameplayScene = null;

// ============================================================================
// ICE SERVER RESOLUTION
// ----------------------------------------------------------------------------
// STUN alone only *discovers* our address - it never carries data. When the
// direct path between two machines is blocked (Windows Firewall, router AP
// isolation, mDNS filtering, or a router that won't hairpin NAT), the only way
// through is a TURN relay. We fetch short-lived TURN credentials from our own
// server, which mints them via Cloudflare.
// ============================================================================
const FALLBACK_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
];

let cachedIceServers = null;

function describeIceServers(iceServers) {
    const urls = iceServers.flatMap(entry => (Array.isArray(entry.urls) ? entry.urls : [entry.urls]));
    return {
        stun: urls.filter(u => typeof u === 'string' && u.startsWith('stun')).length,
        turn: urls.filter(u => typeof u === 'string' && u.startsWith('turn')).length
    };
}

export async function fetchIceServers() {
    if (cachedIceServers) return cachedIceServers;

    const overrides = window.PEERJS_CONFIG || window.__NSPACE_PEERJS_CONFIG__ || {};

    // Explicit iceServers in the page config win outright (useful for testing).
    if (overrides.config?.iceServers) {
        cachedIceServers = overrides.config.iceServers;
        return cachedIceServers;
    }

    if (!overrides.iceEndpoint) {
        console.warn('[ICE] No iceEndpoint configured - using STUN only (no relay fallback)');
        cachedIceServers = FALLBACK_ICE_SERVERS;
        return cachedIceServers;
    }

    try {
        // Never let a cold/slow server block the game from starting.
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(overrides.iceEndpoint, { signal: controller.signal });
        clearTimeout(abortTimer);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
            throw new Error('Response contained no iceServers');
        }

        cachedIceServers = data.iceServers;
        const counts = describeIceServers(cachedIceServers);
        console.log(`[ICE] Fetched ICE config (source: ${data.source}) - ${counts.stun} STUN, ${counts.turn} TURN urls`);

        if (counts.turn === 0) {
            console.warn('[ICE] No TURN relay available - connections between different machines may fail');
        }
        return cachedIceServers;
    } catch (err) {
        console.error('[ICE] Failed to fetch ICE servers, falling back to STUN only:', err.message);
        cachedIceServers = FALLBACK_ICE_SERVERS;
        return cachedIceServers;
    }
}

function getPeerConfig(iceServers) {
    const overrides = window.PEERJS_CONFIG || window.__NSPACE_PEERJS_CONFIG__ || {};
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const host = overrides.host || (isLocalhost ? 'localhost' : '0.peerjs.com');
    const port = overrides.port ?? (isLocalhost ? 9000 : 443);
    const secure = overrides.secure ?? !isLocalhost;
    const path = overrides.path || (isLocalhost ? '/peerjs' : '/');

    return {
        host,
        port,
        secure,
        path,
        debug: 2,
        config: {
            iceServers: iceServers || cachedIceServers || FALLBACK_ICE_SERVERS,
            iceCandidatePoolSize: 4
        }
    };
}

// ============================================================================
// ICE DIAGNOSTICS
// ----------------------------------------------------------------------------
// A failed WebRTC connection is otherwise completely silent: the DataConnection
// simply never opens and no 'error' event fires. These hooks turn that silence
// into an actionable diagnosis.
// ============================================================================
function attachIceDiagnostics(conn, label) {
    const gathered = { host: 0, srflx: 0, relay: 0, prflx: 0 };
    conn.__iceGathered = gathered;

    const pc = conn.peerConnection;
    if (!pc) {
        // peerConnection isn't created synchronously in all PeerJS paths.
        setTimeout(() => {
            if (conn.peerConnection && !conn.__iceHooked) attachIceDiagnostics(conn, label);
        }, 100);
        return;
    }
    conn.__iceHooked = true;

    pc.addEventListener('icecandidate', (event) => {
        if (!event.candidate || !event.candidate.candidate) return;
        const type = event.candidate.type || (event.candidate.candidate.split(' ')[7]);
        if (type in gathered) gathered[type]++;
    });

    pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
            console.log(`[ICE:${label}] Gathered candidates:`, gathered);
        }
    });

    pc.addEventListener('iceconnectionstatechange', () => {
        const state = pc.iceConnectionState;
        console.log(`[ICE:${label}] connection state: ${state}`);

        if (state === 'connected' || state === 'completed') {
            void logSelectedCandidatePair(pc, label);
        } else if (state === 'failed') {
            console.error(`[ICE:${label}] NEGOTIATION FAILED`);
            console.error(`[ICE:${label}] ${explainIceFailure(gathered)}`);
            if (logFeedback) {
                logFeedback(`<span style="color: #ff4444;">LINK FAILED: ${explainIceFailure(gathered)}</span>`);
            }
            if (connectionTimeout) {
                clearTimeout(connectionTimeout);
                connectionTimeout = null;
            }
            if (!gameState.meta.isHost) disconnectNetwork();
        }
    });
}

function explainIceFailure(gathered) {
    if (gathered.srflx === 0 && gathered.relay === 0) {
        return 'No STUN/TURN candidates gathered - UDP is likely blocked on this network.';
    }
    if (gathered.relay === 0) {
        return 'No TURN relay candidates - direct path blocked and no relay available. Check TURN credentials.';
    }
    return 'Relay was available but no candidate pair succeeded - possible firewall or restrictive proxy.';
}

async function logSelectedCandidatePair(pc, label) {
    try {
        const stats = await pc.getStats();
        let pair = null;
        const candidates = new Map();

        stats.forEach(report => {
            if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                candidates.set(report.id, report);
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
                pair = report;
            }
        });

        if (pair) {
            const local = candidates.get(pair.localCandidateId);
            const remote = candidates.get(pair.remoteCandidateId);
            const localDesc = `${local?.candidateType}(${local?.protocol})`;
            const remoteDesc = `${remote?.candidateType}(${remote?.protocol})`;
            console.log(`[ICE:${label}] Selected pair: ${localDesc} <-> ${remoteDesc}`);

            if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') {
                console.log(`[ICE:${label}] Using TURN relay - the direct path was blocked.`);
            }
        }
    } catch (err) {
        console.warn(`[ICE:${label}] Could not read connection stats:`, err.message);
    }
}


// Helper to get connections array (for dependency injection)
function getConnections() { return connections; }
function getPeer() { return peer; }
function getConnection() { return connection; }
function getGameplayScene() { return gameplayScene; }

export function setGameplayScene(scene) {
    gameplayScene = scene;
}

// ============================================================================
// ROOM CODE GENERATION
// ============================================================================
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code.slice(0, 3) + '-' + code.slice(3); // e.g. "ABC-123"
}

// ============================================================================
// HOST INITIALIZATION ENGINE
// ============================================================================
export async function initHost(onFeedbackLog, onChatLog, onDisconnect) {
    logFeedback = onFeedbackLog;
    logChat = onChatLog;
    onNetworkDisconnectCallback = onDisconnect;

    // Set up dependencies for other modules
    setHeartbeatDependencies(broadcastToAll, logFeedback, handleHostDisconnect, () => connection, () => peer, getConnections);
    setMigrationDependencies(broadcastToAll, logFeedback, () => peer, () => connection, getConnections, disconnectNetwork, setupDataChannel, getGameplayScene);
    setMessageDependencies(broadcastToAll, logChat, logFeedback, () => peer, () => connection, disconnectNetwork, null, getGameplayScene, () => globalBeamPool, () => globalSparkPool);
    setCannonWeaponDependencies(() => connection, broadcastToAll);

    // Resolve TURN/STUN credentials before opening the peer - the ICE config
    // cannot be changed after the connection is created.
    const iceServers = await fetchIceServers();

    // Generate a short room code and use it as our Peer ID
    const roomCode = generateRoomCode();
    peer = new Peer(`nspace-${roomCode}`, getPeerConfig(iceServers));


    // Initialize join order with host as first entry
    initJoinOrder();

    peer.on('open', (id) => {
        gameState.meta.currentRoomCode = roomCode; // The SHORT code, not the full peer ID
        prependToJoinOrder(id);

        // Host registers themselves locally as the pilot leader
        registerPlayer(id, "HOST_PILOT", true);
        renderConsole();
        logFeedback(`BEACON ESTABLISHED.`);
        navigator.clipboard.writeText(roomCode).then(() => {
            logFeedback(`ROOM CODE: <span style="color:#fff; font-weight:bold;">${roomCode}</span>`);
            logFeedback(`<span style="color:#00ff88; font-size:11px;">[SYSTEM]: Copied to clipboard automatically!</span>`);
        }).catch(() => {
            logFeedback(`ROOM CODE: <span style="color:#fff; font-weight:bold;">${roomCode}</span>`);
        });

        // Start heartbeat to detect dead clients
        startHostHeartbeat();
    });

    peer.on('connection', (conn) => {
        console.log('[NETWORK] Incoming PeerJS connection request from', conn.peer);
        // GATEKEEPER: Check current squad size before accepting the handshake
        const currentSquadSize = Object.keys(gameState.players).length;

        if (currentSquadSize >= MAX_PLAYERS) {
            console.warn(`[NETWORK]: Lobby full. Rejecting connection from: ${conn.peer}`);
            conn.on('open', () => {
                conn.send({ type: 'LOBBY_FULL_REJECTION' });
                setTimeout(() => conn.close(), 200);
            });
            return;
        }

        // Surface ICE progress for this incoming client.
        attachIceDiagnostics(conn, `host:${conn.peer}`);

        // Pass the raw connection into our unified data router
        setupDataChannel(conn);
    });


    peer.on('error', (err) => {
        console.error('[NETWORK] PeerJS host error:', err);
        logFeedback(`<span style="color: #ff4444;">SIGNALING ERROR: ${err.type}</span>`);
        disconnectNetwork();
    });
}

// ============================================================================
// CLIENT INITIALIZATION ENGINE
// ============================================================================
export async function initClient(roomCode, onFeedbackLog, onChatLog, onDisconnect) {
    logFeedback = onFeedbackLog;
    logChat = onChatLog;
    onNetworkDisconnectCallback = onDisconnect;

    // Set up dependencies for other modules
    setHeartbeatDependencies(broadcastToAll, logFeedback, handleHostDisconnect, () => connection, () => peer, getConnections);
    setMigrationDependencies(broadcastToAll, logFeedback, () => peer, () => connection, getConnections, disconnectNetwork, setupDataChannel, getGameplayScene);
    setMessageDependencies(broadcastToAll, logChat, logFeedback, () => peer, () => connection, disconnectNetwork, null, getGameplayScene, () => globalBeamPool, () => globalSparkPool);
    setCannonWeaponDependencies(() => connection, broadcastToAll);

    // Resolve TURN/STUN credentials before opening the peer - the ICE config
    // cannot be changed after the connection is created.
    const iceServers = await fetchIceServers();

    peer = new Peer(undefined, getPeerConfig(iceServers));

    peer.on('error', (err) => {
        console.error('[NETWORK] PeerJS client error:', err.type, err);

        // NOTE: PeerJS emits 'peer-unavailable', NOT 'peer-not-found'.
        if (err.type === 'peer-unavailable') {
            logFeedback(`<span style="color: #ff4444;">LINK FAILED: Room "${roomCode}" not found. Check the code and that the host is still online.</span>`);
        } else if (err.type === 'network' || err.type === 'server-error') {
            logFeedback(`<span style="color: #ff4444;">LINK FAILED: Network error (${err.type}). Retrying...</span>`);
            // Don't disconnect on transient network errors — let PeerJS retry
            return;
        } else {
            logFeedback(`<span style="color: #ff4444;">LINK FAILED: Aborted (${err.type}).</span>`);
        }
        disconnectNetwork();
    });

    peer.on('open', () => {
        console.log('[NETWORK] PeerJS client opened with id', peer.id);

        // Resolve the room code to the full Peer ID
        // Short codes get the "nspace-" prefix, full UUIDs are used as-is
        const fullPeerId = roomCode.includes('-') && roomCode.length <= 7
            ? `nspace-${roomCode}`
            : roomCode;

        console.log('[NETWORK] Attempting connection to host', fullPeerId);

        // Clients assign their single connection target
        connection = peer.connect(fullPeerId, {
            reliable: true
        });

        connection.on('open', () => {
            console.log('[NETWORK] Data channel opened with host');
        });

        connection.on('error', (err) => {
            console.error('[NETWORK] Connection error:', err);
            logFeedback(`<span style="color: #ff4444;">CONNECTION ERROR: ${err.type || 'unknown'}</span>`);
        });

        // Surface ICE progress - without this a failure is completely silent.
        attachIceDiagnostics(connection, 'client');

        setupDataChannel(connection);

        // 30s covers a cold-starting free-tier signaling server. ICE failures
        // are reported immediately by attachIceDiagnostics, so this only fires
        // when nothing at all is happening.
        connectionTimeout = setTimeout(() => {
            const gathered = connection?.__iceGathered;
            let detail = 'No response from host.';
            if (gathered) {
                detail = explainIceFailure(gathered);
                console.error('[ICE:client] Timed out. Candidates gathered:', gathered);
            }
            logFeedback(`<span style="color: #ff4444;">LINK TIMEOUT (30s): ${detail}</span>`);
            disconnectNetwork();
        }, 30000);
    });
}


// ============================================================================
// UNIFIED DATA CHANNEL ROUTER
// ============================================================================
export function setupDataChannel(conn) {
    conn.on('open', () => {
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
        }

        if (gameState.meta.isHost) {
            // Add this specific client to the host's tracking array
            connections.push(conn);

            // Track heartbeat pong time for this client
            getClientLastPong().set(conn.peer, Date.now());

            // Add to join order
            addToJoinOrder(conn.peer);

            // Calculate their designation number
            const assignedSlot = Object.keys(gameState.players).length + 1;
            const assignedTag = `SQUAD_MATE_${assignedSlot}`;

            // Register them into the host's master game state dictionary
            registerPlayer(conn.peer, assignedTag, false);

            // Detect if the host is already in gameplay
            const isGameRunning = (gameState.meta.gamePhase === 'PLAYING');

            void ensureAsteroidField(gameplayScene, undefined, gameState.meta.asteroidSeed).then(() => {
                conn.send({
                    type: 'HANDSHAKE_ACCEPT',
                    assignedTag: assignedTag,
                    isGameRunning,
                    players: gameState.players,
                    joinOrder: getJoinOrder(),
                    asteroidState: createAsteroidSnapshot(),
                    asteroidSeed: gameState.meta.asteroidSeed
                });
            });

            // Broadcast the freshly updated master roster to EVERY active client
            broadcastToAll({ type: 'ROSTER_UPDATE', players: gameState.players, joinOrder: getJoinOrder() });

            // Late-join sync: If the match is already active, materialize the
            // newcomer and also push every existing ship to their scene.
            if (isGameRunning) {
                spawnSingleShip(conn.peer, gameplayScene);
                broadcastToAll({ type: 'SPAWN_SINGLE_PEER', peerId: conn.peer }, conn.peer);

                Object.keys(gameState.players).forEach(peerId => {
                    if (peerId === conn.peer) return;
                    conn.send({ type: 'SPAWN_SINGLE_PEER', peerId });
                });
            }

            // Broadcast chat message to all clients except the newcomer
            broadcastToAll({
                type: 'SYSTEM_ALERT',
                text: `Squad member connected: <span style="color:#00ffff;">${assignedTag}</span>`
            }, conn.peer);

            logFeedback(`Squad member connected: <span style="color:#00ffff;">${assignedTag}</span>`);
            renderConsole();
        } else {
            // Client connected to host - start heartbeat monitoring
            startClientHeartbeat();
            renderConsole();
            logFeedback(`SYSTEM: Direct link operational. [TAB] to toggle chat.`);
        }
    });

    conn.on('data', (data) => {
        handleMessageData(conn, data);
    });

    conn.on('close', () => {
        if (gameState.meta.isHost) {
            // Remove the dead link from the array safely
            const deadPeerId = conn.peer;
            connections.splice(connections.findIndex(c => c.peer === deadPeerId), 1);
            removePlayer(deadPeerId);
            getClientLastPong().delete(deadPeerId);

            // Remove from join order
            removeFromJoinOrder(deadPeerId);

            // Wipe their 3D mesh
            if (gameplayScene) {
                despawnShip(deadPeerId, gameplayScene);
            }

            // Broadcast the shrunk roster to survivors
            broadcastToAll({ type: 'ROSTER_UPDATE', players: gameState.players, joinOrder: getJoinOrder() });

            // Command all other active clients to wipe this player's 3D ship
            broadcastToAll({ type: 'DESPAWN_PEER', peerId: deadPeerId });

            logFeedback('<span style="color: #ffb703;">SYSTEM: A team member dropped offline.</span>');
            renderConsole();
        } else {
            // Client lost connection to host — this is handled by heartbeat timeout
            // or by the host migration system
            if (intentionalDisconnect) {
                intentionalDisconnect = false;
            } else {
                logFeedback('<span style="color: #ffb703;">SYSTEM: Connection to squad leader severed.</span>');
                stopHeartbeat();
                handleHostDisconnect();
            }
        }
    });
}

// ============================================================================
// GLOBAL NETWORK BROADCAST UTILITIES
// ============================================================================
export function broadcastToAll(packet, excludePeerId = null) {
    connections.forEach(conn => {
        if (conn.open && conn.peer !== excludePeerId) {
            conn.send(packet);
        }
    });
}

// ============================================================================
// MOVEMENT SYNC - Send local player position/rotation/throttle/aux to host
// ============================================================================
export function sendPlayerMovement(peerId, x, y, z, rotationX, rotationY, rotationZ, throttle, deltaEulerX, deltaEulerY, deltaEulerZ) {
    if (gameState.meta.isHost) {
        // Host sends to all other clients
        broadcastToAll({
            type: 'PLAYER_MOVEMENT',
            peerId,
            x,
            y,
            z,
            rotationX,
            rotationY,
            rotationZ,
            throttle,
            deltaEulerX,
            deltaEulerY,
            deltaEulerZ
        }, peerId); // Exclude sender
    } else if (connection && connection.open) {
        // Client sends to host only
        connection.send({
            type: 'PLAYER_MOVEMENT',
            peerId,
            x,
            y,
            z,
            rotationX,
            rotationY,
            rotationZ,
            throttle,
            deltaEulerX,
            deltaEulerY,
            deltaEulerZ
        });
    }
}


// ============================================================================
// DISCONNECT & CLEANUP
// ============================================================================
export function disconnectNetwork() {
    intentionalDisconnect = true;   // Prevent host migration from firing on connection.close()
    stopHeartbeat();

    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }

    document.getElementById('ui-capsule')?.classList.remove('gameplay-mode');

    // Host cleanup: Sever all lines cleanly
    connections.forEach(conn => conn.close());
    connections = [];

    // Client cleanup
    if (connection) {
        connection.close();
        connection = null;
    }

    if (peer) {
        peer.destroy();
        peer = null;
    }

    // Reset join order
    initJoinOrder();
    getClientLastPong().clear();
    cachedIceServers = null;   // Re-fetch credentials on the next session

    // Clear the latch AFTER the pending 'close' events have flushed. Resetting
    // it synchronously would defeat its purpose (close fires on a later tick),
    // but leaving it latched forever means the next genuine host drop gets
    // silently swallowed and host migration never runs.
    setTimeout(() => { intentionalDisconnect = false; }, 1000);

    if (onNetworkDisconnectCallback) {
        onNetworkDisconnectCallback();
    }
}



// Re-export getLatencyMs from heartbeat module
export { getLatencyMs };
