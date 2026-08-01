// ============================================================================
// RETICLE MANAGER — Routes reticle operations based on ship type
// ============================================================================

import * as THREE from 'three';
import * as viking1Reticle from './viking1Reticle.js';
import { globalTargetManager } from './targetManager.js';
import { gameState } from './gameState.js';
import { localPlayerShip } from './fleetManager.js';
import { camera, gameplayScene } from './view3d.js';
import { getShipPreset } from './gameState.js';

// Re-export reticle helper functions
export { setReticleCamera, projectWorldToScreen } from './viking1Reticle.js';

// Cleanup reference for the current reticle module
let currentReticleModule = null;

// Map of available reticles by ship type
const reticleModules = {
    'viking1': viking1Reticle
    // Future ship types can be added here:
    // 'raptor': raptorReticle,
    // 'scout': scoutReticle,
};

let currentShipType = null;

/**
 * Initialize the reticle system for a specific ship type
 * @param {string} shipType - The type of ship (e.g., 'viking1')
 */
export function initReticleForShipType(shipType) {
    const module = getReticleModule(shipType);
    if (module && module.initViking1Reticle) {
        module.initViking1Reticle();
        currentShipType = shipType;
        console.log(`[RETICLE MANAGER]: Initialized reticle for ship type: ${shipType}`);
    }
}

/**
 * Draw the reticle appropriate for the current ship type
 * @param {string} shipType - The type of ship (e.g., 'viking1')
 * @param {boolean} cameraInLock - Whether a target is within camera lock cone
 * @param {boolean} shipInLock - Whether a target is within ship lock cone
 * @param {Array} weaponState - Array of weapon objects with canFire() method
 * @param {number} hpPercent - Current HP as percentage (0-1), default 1.0
 * @param {number} lastDamageTime - Timestamp of last damage taken (in seconds), default -Infinity
 * @param {boolean} killFeedbackVisible - Whether the kill feedback X should be shown
 */
export function drawReticleForShipType(shipType, cameraInLock, shipInLock, weaponState, hasRadarTargetInRange = false, hpPercent = 1.0, lastDamageTime = -Infinity, killFeedbackVisible = false) {
    const module = getReticleModule(shipType);
    if (module && module.drawViking1Reticle) {
        module.drawViking1Reticle(cameraInLock, shipInLock, weaponState, hasRadarTargetInRange, hpPercent, lastDamageTime, killFeedbackVisible);
    }
}

/**
 * Resize the reticle appropriate for the current ship type
 * @param {string} shipType - The type of ship (e.g., 'viking1')
 */
export function resizeReticleForShipType(shipType) {
    const module = getReticleModule(shipType);
    if (module && module.resizeViking1Reticle) {
        module.resizeViking1Reticle();
    }
}

/**
 * Get the reticle module for a given ship type
 * Falls back to viking1 if ship type is not found
 * @param {string} shipType - The type of ship
 * @returns {Object|null} The reticle module or null
 */
function getReticleModule(shipType) {
    if (reticleModules[shipType]) {
        return reticleModules[shipType];
    }
    
    // Fallback to viking1 if ship type is unknown
    console.warn(`[RETICLE MANAGER]: Unknown ship type '${shipType}', falling back to viking1`);
    return reticleModules['viking1'];
}

/**
 * Get the current active ship type
 * @returns {string|null} The current ship type or null
 */
export function getCurrentShipType() {
    return currentShipType;
}

/**
 * Set the current ship type (useful for handling ship type changes mid-game)
 * @param {string} shipType - The type of ship
 */
export function setCurrentShipType(shipType) {
    if (shipType !== currentShipType) {
        console.log(`[RETICLE MANAGER]: Ship type changed from '${currentShipType}' to '${shipType}'`);
        currentShipType = shipType;
    }
}

/**
 * Update the reticle display based on current targeting status
 * This function should be called once per frame from the main animation loop
 * @param {Array} weaponState - Array of weapon objects with fire rate information
 */
export function updateReticle(weaponState = []) {
    if (!localPlayerShip || !camera) return;

    const isPlayerDead = localPlayerShip.userData?.isDead || localPlayerShip.userData?.hpManager?.isDead;
    if (isPlayerDead) {
        viking1Reticle.clearViking1Reticle();
        return;
    }

    // Initialize target manager's scene on first call (when gameplayScene is available)
    if (gameplayScene && !globalTargetManager.scene) {
        globalTargetManager.setScene(gameplayScene);
    }

    // Get ship type and targeting parameters
    const playerData = gameState.players[localPlayerShip.userData.peerId];
    const shipType = playerData?.shipType || 'viking1';
    const shipPreset = getShipPreset(shipType);
    const lockAngleDegrees = shipPreset?.statistics?.lockAngleDegrees || 15;
    const maxRange = shipPreset?.statistics?.range || 500;
    const radarRange = shipPreset?.statistics?.radarRange || 1000;

    // Set the camera reference for screen space projection
    viking1Reticle.setReticleCamera(camera);

    // Get ship position and forward axis
    const shipPos = new THREE.Vector3();
    localPlayerShip.getWorldPosition(shipPos);
    const shipForwardAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(localPlayerShip.quaternion);

    // Check if there's a valid target in the ship's lock cone (with line of sight check)
    const shipHasTarget = globalTargetManager.findClosestTarget(
        shipPos,
        shipForwardAxis,
        maxRange,
        lockAngleDegrees,
        true  // Enable line of sight checking
    ) !== null;

    // Check if there's a valid target in the camera's lock cone (with line of sight check)
    const cameraHasTarget = globalTargetManager.isCameraTargetInLockCone(
        camera,
        lockAngleDegrees,
        maxRange,
        true  // Enable line of sight checking
    );

    // Get all targets within radar range
    const radarTargets = globalTargetManager.getTargetsInRange(shipPos, radarRange);
    const hasRadarTargetInRange = radarTargets.length > 0;

    // Project radar targets to screen space (including behind-camera targets for arrows)
    const radarScreenPositions = [];
    for (const target of radarTargets) {
        const screenPos = viking1Reticle.projectWorldToScreen(target.position, camera, true);
        if (screenPos) {
            const hasLineOfSight = globalTargetManager.checkLineOfSight(shipPos, target.object, target.distance);
            const isWithinWeaponRange = target.distance <= maxRange;

            radarScreenPositions.push({
                screenPos: screenPos,
                worldPosition: target.position,
                alive: !target.object.userData?.isDead && target.object.scale.x !== 0,
                hasLineOfSight: hasLineOfSight,
                isWithinWeaponRange: isWithinWeaponRange
            });
        }
    }

    // Draw the reticle with the targeting information
    // Get HP percentage and last damage time from the local player ship's HP manager
    const hpPercent = (localPlayerShip.userData && localPlayerShip.userData.hpManager) 
        ? localPlayerShip.userData.hpManager.getHPPercentage() 
        : 1.0;
    const lastDamageTime = (localPlayerShip.userData && localPlayerShip.userData.hpManager)
        ? localPlayerShip.userData.hpManager.lastDamageTime
        : -Infinity;
    const killFeedbackVisible = (localPlayerShip.userData && localPlayerShip.userData.hpManager)
        ? localPlayerShip.userData.hpManager.getKillFeedbackVisibility(performance.now() / 1000)
        : false;

    // Draw the reticle with the targeting information, radar alert indicator, HP percentage, damage timestamp, and kill feedback state
    drawReticleForShipType(shipType, cameraHasTarget, shipHasTarget, weaponState, hasRadarTargetInRange, hpPercent, lastDamageTime, killFeedbackVisible);

    // Draw radar rectangles for all targets in radar range
    viking1Reticle.drawRadarRectangles(radarScreenPositions);
}

/**
 * Cleanup and destroy the reticle system
 */
export function cleanupReticle() {
    if (currentShipType) {
        const module = getReticleModule(currentShipType);
        if (module && module.destroyViking1Reticle) {
            module.destroyViking1Reticle();
        }
    }
    currentShipType = null;
    currentReticleModule = null;
    console.log('[RETICLE MANAGER]: Reticle cleaned up');
}
