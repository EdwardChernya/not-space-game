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

function getPeerConfig() {
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
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        }
    };
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
export function initHost(onFeedbackLog, onChatLog, onDisconnect) {
    logFeedback = onFeedbackLog;
    logChat = onChatLog;
    onNetworkDisconnectCallback = onDisconnect;

    // Set up dependencies for other modules
    setHeartbeatDependencies(broadcastToAll, logFeedback, handleHostDisconnect, () => connection, () => peer, getConnections);
    setMigrationDependencies(broadcastToAll, logFeedback, () => peer, () => connection, getConnections, disconnectNetwork, setupDataChannel, getGameplayScene);
    setMessageDependencies(broadcastToAll, logChat, logFeedback, () => peer, () => connection, disconnectNetwork, null, getGameplayScene, () => globalBeamPool, () => globalSparkPool);
    setCannonWeaponDependencies(() => connection, broadcastToAll);

    // Generate a short room code and use it as our Peer ID
    const roomCode = generateRoomCode();
    peer = new Peer(`nspace-${roomCode}`, getPeerConfig());

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
export function initClient(roomCode, onFeedbackLog, onChatLog, onDisconnect) {
    logFeedback = onFeedbackLog;
    logChat = onChatLog;
    onNetworkDisconnectCallback = onDisconnect;

    // Set up dependencies for other modules
    setHeartbeatDependencies(broadcastToAll, logFeedback, handleHostDisconnect, () => connection, () => peer, getConnections);
    setMigrationDependencies(broadcastToAll, logFeedback, () => peer, () => connection, getConnections, disconnectNetwork, setupDataChannel, getGameplayScene);
    setMessageDependencies(broadcastToAll, logChat, logFeedback, () => peer, () => connection, disconnectNetwork, null, getGameplayScene, () => globalBeamPool, () => globalSparkPool);
    setCannonWeaponDependencies(() => connection, broadcastToAll);

    peer = new Peer(undefined, getPeerConfig());

    peer.on('open', () => {
        console.log('[NETWORK] PeerJS client opened with id', peer.id);
    });

    peer.on('error', (err) => {
        if (err.type === 'peer-not-found') {
            logFeedback(`<span style="color: #ff4444;">LINK FAILED: Target token "${roomCode}" not found.</span>`);
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

        setupDataChannel(connection);

        // Increased timeout: 15 seconds (was 5)
        connectionTimeout = setTimeout(() => {
            logFeedback('<span style="color: #ff4444;">LINK TIMEOUT: Server non-responsive after 15s. Aborting.</span>');
            disconnectNetwork();
        }, 15000);
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

    if (onNetworkDisconnectCallback) {
        onNetworkDisconnectCallback();
    }
}

// Re-export getLatencyMs from heartbeat module
export { getLatencyMs };
