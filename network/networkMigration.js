// ============================================================================
// HOST MIGRATION - When the host drops, the oldest client takes over
// ============================================================================

import { gameState, STATES } from '../gameState.js';
import { renderConsole } from '../console.js';
import { despawnShip } from '../fleetManager.js';
import { startHostHeartbeat } from './networkHeartbeat.js';

// Join order list maintained by host and broadcast to clients
let joinOrder = [];  // Ordered array of peer IDs (host first, then clients by join time)

// Dependencies to be set by networkCore
let broadcastToAllFn = null;
let logFeedbackFn = null;
let peerFn = null;
let connectionFn = null;
let connectionsFn = null;
let disconnectNetworkFn = null;
let setupDataChannelFn = null;
let gameplaySceneFn = null;

export function setMigrationDependencies(broadcastToAll, logFeedback, peer, connection, connections, disconnectNetwork, setupDataChannel, gameplayScene) {
    broadcastToAllFn = broadcastToAll;
    logFeedbackFn = logFeedback;
    peerFn = peer;
    connectionFn = connection;
    connectionsFn = connections;
    disconnectNetworkFn = disconnectNetwork;
    setupDataChannelFn = setupDataChannel;
    gameplaySceneFn = gameplayScene;
}

export function handleHostDisconnect() {
    // Determine who should become the new host
    // joinOrder[0] is the old host, joinOrder[1] is the first client, etc.
    const myPeerId = peerFn()?.id;
    const myIndex = joinOrder.indexOf(myPeerId);

    // Clean up the dead connection to the old host
    if (connectionFn()) {
        connectionFn().close();
    }

    if (myIndex === 1 || (myIndex === -1 && joinOrder.length <= 1)) {
        // WE are the successor (first in line after the old host)
        logFeedbackFn('<span style="color: #00ff88;">HOST MIGRATION: You are the new squad leader!</span>');
        logFeedbackFn('<span style="color: #ffb703;">Promoting to host mode...</span>');

        // Promote this client to host
        promoteToHost();
    } else if (myIndex > 1) {
        // We are NOT the successor - wait for the new host to reach out
        logFeedbackFn('<span style="color: #ffb703;">HOST MIGRATION: Squad leader fell. Awaiting new host beacon...</span>');
        listenForNewHost();
    } else {
        // We weren't in the join order at all (edge case) — just disconnect
        logFeedbackFn('<span style="color: #ff4444;">HOST DISCONNECTED: Unable to determine migration successor.</span>');
        disconnectNetworkFn();
    }
}

export function promoteToHost() {
    // Capture the old host's peer ID before removing them
    const oldHostId = joinOrder[0];

    // Remove old host from join order
    joinOrder.shift();

    // Despawn the old host's ship from our 3D scene
    const scene = gameplaySceneFn();
    if (oldHostId && gameState.meta.gamePhase === STATES.PLAYING && scene) {
        despawnShip(oldHostId, scene);
    }

    // Switch to host mode
    gameState.meta.isHost = true;
    gameState.meta.isMultiplayer = true;

    // Mark ourselves as local
    Object.keys(gameState.players).forEach(id => {
        gameState.players[id].isLocal = (id === peerFn().id);
    });

    // Start listening for incoming connections on our existing Peer
    peerFn().on('connection', (conn) => {
        setupDataChannelFn(conn);
    });

    // Initialize the heartbeat as the new host
    connectionsFn().length = 0; // Clear connections array

    // Re-register remaining players from join order
    const newPlayers = {};
    joinOrder.forEach((peerId, index) => {
        const existingPlayer = gameState.players[peerId];
        if (existingPlayer) {
            const isLocal = (peerId === peerFn().id);
            newPlayers[peerId] = {
                ...existingPlayer,
                isLocal: isLocal,
                tag: isLocal ? 'HOST_PILOT' : `SQUAD_MATE_${index}`
            };
        }
    });
    gameState.players = newPlayers;

    // Update room code to our peer ID
    gameState.meta.currentRoomCode = peerFn().id;

    startHostHeartbeat();
    renderConsole();

    navigator.clipboard.writeText(peerFn().id).then(() => {
        logFeedbackFn(`NEW ROOM CODE: <span style="color:#fff; font-weight:bold;">${peerFn().id}</span>`);
        logFeedbackFn(`<span style="color:#00ff88; font-size:11px;">[SYSTEM]: Copied to clipboard automatically!</span>`);
    }).catch(() => {
        logFeedbackFn(`NEW ROOM CODE: <span style="color:#fff; font-weight:bold;">${peerFn().id}</span>`);
    });

    // Broadcast the new state to any clients that connect
    broadcastToAllFn({ type: 'HOST_MIGRATE', newHostId: peerFn().id, players: gameState.players, joinOrder });
}

export function listenForNewHost() {
    // The successor (joinOrder[1]) will become the new host
    // We wait for them to connect to us, or we try connecting to them
    const newHostId = joinOrder[1];
    if (!newHostId) {
        disconnectNetworkFn();
        return;
    }

    // Try connecting to the new host
    const migrationTimeout = setTimeout(() => {
        logFeedbackFn('<span style="color: #ff4444;">HOST MIGRATION FAILED: New host unreachable.</span>');
        disconnectNetworkFn();
    }, 15000);

    // Wait a moment for the new host to set up, then connect
    setTimeout(() => {
        const newConn = peerFn().connect(newHostId);
        setupDataChannelFn(newConn);

        newConn.on('open', () => {
            clearTimeout(migrationTimeout);
            logFeedbackFn('<span style="color: #00ff88;">Reconnected to new squad leader.</span>');
        });
    }, 2000);
}

// Getters and setters for join order
export function getJoinOrder() { return [...joinOrder]; }
export function setJoinOrder(order) { joinOrder = order; }
export function addToJoinOrder(peerId) {
    if (!joinOrder.includes(peerId)) {
        joinOrder.push(peerId);
    }
}
export function removeFromJoinOrder(peerId) {
    joinOrder = joinOrder.filter(id => id !== peerId);
}
export function initJoinOrder() {
    joinOrder = [];
}
export function prependToJoinOrder(peerId) {
    joinOrder.unshift(peerId);
}
