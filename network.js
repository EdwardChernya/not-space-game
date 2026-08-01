// ============================================================================
// NETWORK FACADE - Re-exports all network functionality
// ============================================================================

export {
    peer,
    connection,
    connections,
    initHost,
    initClient,
    setupDataChannel,
    broadcastToAll,
    disconnectNetwork,
    getLatencyMs,
    setGameplayScene
} from './network/networkCore.js';

// Re-export heartbeat functions if needed
export {
    startHostHeartbeat,
    startClientHeartbeat,
    stopHeartbeat
} from './network/networkHeartbeat.js';

// Re-export migration functions if needed
export {
    handleHostDisconnect,
    promoteToHost,
    listenForNewHost,
    getJoinOrder,
    setJoinOrder
} from './network/networkMigration.js';

// Re-export message functions if needed
export {
    isValidMessage,
    handleMessageData,
    mergePlayerState
} from './network/networkMessages.js';
