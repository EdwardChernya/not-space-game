// ============================================================================
// GAME STATE FACADE - Core state object and re-exports
// ============================================================================

import { purgeFleet } from './fleetManager.js';

// ============================================================================
// REGISTRY: FINITE STATE MACHINE PHASES
// ============================================================================
export const STATES = {
    BOOT: 'BOOT',
    MAIN_MENU: 'MAIN_MENU',
    LOBBY_HOST: 'LOBBY_HOST',
    LOBBY_JOIN: 'LOBBY_JOIN',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER'
};

export const MAX_PLAYERS = 4;
export let currentGameState = STATES.BOOT;

// ============================================================================
// GLOBAL DATA STORAGE (THE SINGLE SOURCE OF TRUTH)
// ============================================================================
export const gameState = {
    meta: {
        currentRoomCode: null,
        isHost: false,
        isMultiplayer: false,
        gamePhase: STATES.BOOT,
        asteroidSeed: null,
    },
    campaign: {
        currentChapter: 1
    },
    players: {}, // Dynamic dictionary keyed by peerId
    entities: {
        projectiles: {},
        enemies: {},
        particles: {},
        asteroids: {}
    }
};

// ============================================================================
// RE-EXPORT SHIP PRESET FUNCTIONS
// ============================================================================
export {
    SHIP_PRESETS,
    getShipPreset,
    getDefaultPartsForShip,
    validateCustomParts,
    getAvailableShipTypes
} from './core/shipPresets.js';

// ============================================================================
// RE-EXPORT PLAYER STATE FUNCTIONS
// ============================================================================
export {
    updatePlayerCustomParts,
    registerPlayer,
    addPartToPlayerRoster,
    removePlayer
} from './core/playerState.js';

// ============================================================================
// STATE MUTATION WRITERS
// ============================================================================

export function setGameState(newState) {
    if (!STATES[newState]) return;
    currentGameState = newState;
    gameState.meta.gamePhase = newState;
    console.log(`[STATE ENGINE]: Game state transitioned to -> ${newState}`);
}

/**
 * Flags the local engine parameters for network operation mode
 */
export function startMultiplayerSession(isHost, roomCode = null) {
    gameState.meta.isMultiplayer = true;
    gameState.meta.isHost = isHost;
    gameState.meta.currentRoomCode = roomCode; // Will be a string for Joiner, or updated later for Host
    gameState.meta.asteroidSeed = roomCode || `asteroid-seed-${Date.now()}`;
}

/**
 * Adds an asteroid to the entities registry
 */
export function addAsteroid(asteroidId, x, y, z, size, velocityX = 0, velocityY = 0, velocityZ = 0, rotationX = 0, rotationY = 0, rotationZ = 0, modelId = null) {
    gameState.entities.asteroids[asteroidId] = {
        id: asteroidId,
        x, y, z,
        size,
        velocityX,
        velocityY,
        velocityZ,
        rotationX,
        rotationY,
        rotationZ,
        modelId
    };
    //console.log(`[STATE ENGINE]: Asteroid spawned at (${x}, ${y}, ${z}) with size ${size}`);
}

/**
 * Removes an asteroid from the entities registry
 */
export function removeAsteroid(asteroidId) {
    if (gameState.entities.asteroids[asteroidId]) {
        delete gameState.entities.asteroids[asteroidId];
        console.log(`[STATE ENGINE]: Asteroid ${asteroidId} destroyed`);
    }
}

/**
 * Resets network metadata and completely flushes peer players/entities
 * to prevent data leaks or ghost ships when returning to the main menu.
 */
export function purgeMultiplayerSession(targetScene) {
    gameState.meta.isMultiplayer = false;
    gameState.meta.isHost = false;
    gameState.meta.currentRoomCode = null;
    gameState.meta.gamePhase = STATES.MAIN_MENU;
    currentGameState = STATES.MAIN_MENU;
    
    // NEW: Wipe the 3D scene
    purgeFleet(targetScene);

    // Wipe out active live entities and players completely
    gameState.players = {};
    gameState.entities = {
        projectiles: {},
        enemies: {},
        particles: {},
        asteroids: {}
    };
    console.log("[STATE ENGINE]: Multiplayer vectors completely descaled and flushed.");
}

// ============================================================================
// SERIALIZATION SYSTEMS (SAVE / LOAD / LATE-JOIN CATCH-UP)
// ============================================================================

export function serializeUniverse() {
    return JSON.stringify({
        meta: gameState.meta,
        campaign: gameState.campaign,
        players: gameState.players,
        entities: gameState.entities
    });
}

export function deserializeUniverse(jsonString) {
    try {
        const snapshot = JSON.parse(jsonString);
        gameState.meta = snapshot.meta;
        gameState.campaign = snapshot.campaign;
        gameState.players = snapshot.players;
        gameState.entities = snapshot.entities;
        
        // Keep the local decoupled tracking state synchronized
        currentGameState = gameState.meta.gamePhase;
        return true;
    } catch (error) {
        console.error("[STATE ENGINE]: Universe deserialization corrupted.", error);
        return false;
    }
}
