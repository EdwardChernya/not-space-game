// ============================================================================
// HEARTBEAT SYSTEM - Detects dead connections that didn't fire 'close'
// ============================================================================

const HEARTBEAT_INTERVAL = 1000;   // Send a ping every 1 second
const HEARTBEAT_TIMEOUT = 10000;   // Consider dead if no pong within 10 seconds

let heartbeatTimer = null;
let lastPongTime = 0;              // Client: last time we heard from host
let clientLastPong = new Map();    // Host: peerId -> timestamp of last pong
let lastPongSentTime = 0;          // Client: when we last sent a PONG (for RTT measurement)
let currentLatencyMs = 0;          // Client: measured round-trip time in ms

// Will be set by networkCore
let broadcastToAllFn = null;
let logFeedbackFn = null;
let handleHostDisconnectFn = null;
let connectionFn = null;
let peerFn = null;
let connectionsFn = null;

export function setHeartbeatDependencies(broadcastToAll, logFeedback, handleHostDisconnect, connection, peer, connections) {
    broadcastToAllFn = broadcastToAll;
    logFeedbackFn = logFeedback;
    handleHostDisconnectFn = handleHostDisconnect;
    connectionFn = connection;
    peerFn = peer;
    connectionsFn = connections;
}

export function startHostHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        const now = Date.now();
        // Send PING to all clients
        broadcastToAllFn({ type: 'PING', timestamp: now });

        // Check for dead clients (no PONG within timeout)
        clientLastPong.forEach((lastPong, peerId) => {
            if (now - lastPong > HEARTBEAT_TIMEOUT) {
                console.warn(`[HEARTBEAT]: Client ${peerId} timed out — no pong in ${HEARTBEAT_TIMEOUT}ms`);
                // Find and force-close their connection
                const deadConn = connectionsFn().find(c => c.peer === peerId);
                if (deadConn) {
                    deadConn.close(); // This triggers the 'close' handler
                }
            }
        });
    }, HEARTBEAT_INTERVAL);
}

export function startClientHeartbeat() {
    stopHeartbeat();
    lastPongTime = Date.now();
    heartbeatTimer = setInterval(() => {
        const elapsed = Date.now() - lastPongTime;
        if (elapsed > HEARTBEAT_TIMEOUT) {
            console.warn(`[HEARTBEAT]: Host timed out — no ping in ${elapsed}ms`);
            logFeedbackFn('<span style="color: #ff4444;">HOST SIGNAL LOST: Connection leader went dark.</span>');
            stopHeartbeat();
            handleHostDisconnectFn();
        }
    }, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    clientLastPong.clear();
}

export function getLatencyMs() {
    return Math.max(currentLatencyMs - HEARTBEAT_INTERVAL, 0);
}

// Getters for state
export function getHeartbeatInterval() { return HEARTBEAT_INTERVAL; }
export function getHeartbeatTimeout() { return HEARTBEAT_TIMEOUT; }
export function getLastPongTime() { return lastPongTime; }
export function setLastPongTime(time) { lastPongTime = time; }
export function getClientLastPong() { return clientLastPong; }
export function getLastPongSentTime() { return lastPongSentTime; }
export function setLastPongSentTime(time) { lastPongSentTime = time; }
export function getCurrentLatencyMs() { return currentLatencyMs; }
export function setCurrentLatencyMs(time) { currentLatencyMs = time; }
