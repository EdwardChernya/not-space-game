// ============================================================================
// PLAYER STATE - Player registration, removal, and parts management
// ============================================================================

import { gameState } from '../gameState.js';
import { getShipPreset, getDefaultPartsForShip, validateCustomParts } from './shipPresets.js';

/**
 * Updates a player's custom parts configuration
 * @param {string} peerId - The player's peer ID
 * @param {array} customParts - New custom parts array
 * @returns {boolean} True if update successful, false if validation failed
 */
export function updatePlayerCustomParts(peerId, customParts) {
    const player = gameState.players[peerId];
    if (!player) {
        console.warn(`[STATE ENGINE]: Player ${peerId} not found for parts update`);
        return false;
    }

    // Validate against the player's ship type
    if (!validateCustomParts(player.shipType, customParts)) {
        console.warn(`[STATE ENGINE]: Custom parts validation failed for ${peerId}`);
        return false;
    }

    // Update the parts array
    player.parts = customParts;
    console.log(`[STATE ENGINE]: Updated custom parts for ${player.tag} (${player.shipType})`);
    return true;
}

/**
 * Registers a player connection into the live data blueprint.
 * @param {string} peerId - The unique peer identifier
 * @param {string} customTag - The player's display name/tag
 * @param {boolean} isLocal - Whether this is the local player
 * @param {string} shipType - The type of ship (default: 'viking1')
 * @param {array} customParts - Custom parts array, or null to use ship preset defaults
 * @returns {boolean} True if registered successfully, false if lobby full.
 */
export function registerPlayer(peerId, customTag, isLocal = false, shipType = 'viking1', customParts = null) {
    const MAX_PLAYERS = 4;
    const currentCount = Object.keys(gameState.players).length;
    
    if (currentCount >= MAX_PLAYERS) {
        console.warn(`[STATE ENGINE]: Registration rejected for ${peerId}. Squad is full.`);
        return false;
    }

    // Validate ship type
    if (!getShipPreset(shipType)) {
        console.warn(`[STATE ENGINE]: Unknown ship type "${shipType}", falling back to "viking1"`);
        shipType = 'viking1';
    }

    // Determine parts: use custom if provided and valid, otherwise use defaults
    let playerParts = customParts;
    if (!customParts || !Array.isArray(customParts) || customParts.length === 0) {
        playerParts = getDefaultPartsForShip(shipType);
    } else if (!validateCustomParts(shipType, customParts)) {
        console.warn(`[STATE ENGINE]: Custom parts invalid for ${shipType}, falling back to defaults`);
        playerParts = getDefaultPartsForShip(shipType);
    }

    // Local player sits at offset for now
    const startingX = isLocal ? 0 : 2 + 2 * (currentCount - 1);

    // Get ship preset to copy base statistics
    const shipPreset = getShipPreset(shipType);

    gameState.players[peerId] = {
        id: peerId,
        tag: customTag,      
        isLocal: isLocal,
        shipType: shipType,  // Track which preset this player is using
        x: startingX, y: 0, z: 0,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        
        // Instance-specific stats (can be modified for upgrades)
        // These are copied from the preset at spawn time
        shipStats: JSON.parse(JSON.stringify(shipPreset.statistics)),
        
        // The pure data list of what this ship is made of!
        // This is what gets sent over PeerJS and serialized.
        parts: playerParts
    };

    console.log(`[STATE ENGINE]: Registered: ${customTag} [Local: ${isLocal}] [Ship: ${shipType}] (${peerId})`);
    return true;
}

/**
 * Adds a structural component data card to a specific player
 */
export function addPartToPlayerRoster(peerId, partId, glowColor = '#ffffff', intensity = 1) {
    const player = gameState.players[peerId];
    if (!player) return;

    // Push the pure blueprint into the array
    player.parts.push({ id: partId, glowColor, intensity });
    console.log(`[STATE ENGINE]: Data card added to ${player.tag}: ${partId}`);
}

/**
 * Removes a player from the universe when they sever connection
 */
export function removePlayer(peerId) {
    if (gameState.players[peerId]) {
        console.log(`[STATE ENGINE]: Purging player connection: ${gameState.players[peerId].tag}`);
        delete gameState.players[peerId];
    }
}
