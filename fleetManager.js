import * as THREE from 'three';
import { gameState, SHIP_PRESETS } from './gameState.js';
import { buildCustomShip, updateShipThrustVisuals, updateShipAuxVisuals } from './shipBuilder.js';
import { EngineTrail, initializeShipTrails, updateAllMultiplayerTrails, cleanupPlayerTrails } from './EngineTrail.js';
import { WeaponManager, globalBeamPool } from './weaponSystem.js';
import { globalTargetManager } from './targetManager.js';
import { HPManager } from './HPManager.js';
import { broadcastToAll } from './network.js';


// Central registry for active 3D ship groups in the Three.js scene
export let localPlayerShip = null;
export const remoteShips = {};
export let localPlayerWeapons = null;

const targetPosition = new THREE.Vector3();

/**
 * Normalize angle difference to shortest rotational distance
 * Ensures lerp takes the shortest path between angles (handles 2π wrapping)
 * @param {number} from - Current angle in radians
 * @param {number} to - Target angle in radians
 * @returns {number} Shortest angular difference in radians
 */
function getShortestAngleDifference(from, to) {
    let diff = to - from;
    // Normalize to [-π, π] range
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}




// Respawn tracking for dead ships

const respawnTimers = new Map(); // peerId -> { deathTime, respawnDelay }
export const RESPAWN_DELAY = 3; // seconds before respawn

/**
 * Finds a safe spawn location that doesn't collide with asteroids
 * @param {THREE.Scene} scene - The gameplay scene
 * @param {THREE.Vector3} preferredPos - Preferred spawn position
 * @param {number} maxAttempts - Maximum attempts to find safe location
 * @returns {THREE.Vector3} Safe spawn position
 */
export function findSafeSpawnLocation(scene, preferredPos = new THREE.Vector3(0, 0, 0), maxAttempts = 100, shipType = 'viking1') {
    const shipCollisionRadius = 3;
    const MAP_HALF_EXTENT = 750;
    const MIN_SPAWN_CLEARANCE_FROM_SHIPS = 40;
    const shipPreset = SHIP_PRESETS[shipType] || SHIP_PRESETS.viking1;
    const radarRange = shipPreset?.statistics?.radarRange || 1200;

    // If scene is not ready, return the preferred center as-is
    if (!scene) {
        return preferredPos.clone();
    }

    // Collect all asteroids and active ships from the scene
    const asteroids = [];
    const activeShips = [];
    scene.traverse((child) => {
        if (child.userData && child.userData.collisionRadius !== undefined) {
            asteroids.push(child);
        }

        if (child.isObject3D && child.userData && child.userData.peerId !== undefined) {
            activeShips.push(child);
        }
    });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const testPos = new THREE.Vector3(
            (Math.random() - 0.5) * MAP_HALF_EXTENT * 2,
            (Math.random() - 0.5) * 400,
            (Math.random() - 0.5) * MAP_HALF_EXTENT * 2
        );

        // Keep the spawn inside the map bounds.
        if (
            Math.abs(testPos.x) > MAP_HALF_EXTENT ||
            Math.abs(testPos.z) > MAP_HALF_EXTENT ||
            Math.abs(testPos.y) > 200
        ) {
            continue;
        }

        let isSafe = true;

        // Check asteroid clearance
        for (const asteroid of asteroids) {
            const asteroidPos = asteroid.position;
            const collisionRadius = asteroid.userData.collisionRadius;
            const distanceToAsteroid = testPos.distanceTo(asteroidPos);
            const minDistance = shipCollisionRadius + collisionRadius + 5;

            if (distanceToAsteroid < minDistance) {
                isSafe = false;
                break;
            }
        }

        if (!isSafe) {
            continue;
        }

        // Check ship clearance
        for (const ship of activeShips) {
            if (ship.position.distanceTo(testPos) < MIN_SPAWN_CLEARANCE_FROM_SHIPS) {
                isSafe = false;
                break;
            }
        }

        if (!isSafe) {
            continue;
        }

        // Prefer positions that are outside radar range of the current player.
        // The preferred position is still used as a fallback if no such location is found.
        const distanceFromPreferred = preferredPos.distanceTo(testPos);
        if (distanceFromPreferred < radarRange) {
            continue;
        }

        return testPos;
    }

    // Fallback: use a random point within the map bounds, even if it is inside radar range.
    console.warn(`[FLEET MANAGER]: Could not find a map-safe spawn outside radar range after ${maxAttempts} attempts. Using fallback.`);
    return new THREE.Vector3(
        (Math.random() - 0.5) * MAP_HALF_EXTENT * 2,
        (Math.random() - 0.5) * 400,
        (Math.random() - 0.5) * MAP_HALF_EXTENT * 2
    );
}

/**
 * SCENARIO A: Surgically spawns a single specific player when they connect or change systems
 */
export function spawnSingleShip(peerId, targetScene) {
    // 1. Safety Guard: If this ship already has a physical 3D mesh in memory, abort!
    if (remoteShips[peerId] || (localPlayerShip && localPlayerShip.userData.peerId === peerId)) {
        console.log(`[FLEET MANAGER]: Blocked duplicate spawn attempt for peer: ${peerId}`);
        return;
    }

    const playerData = gameState.players[peerId];
    if (!playerData) {
        console.warn(`[FLEET MANAGER]: Cannot spawn ship. Peer ID ${peerId} missing from gameState.`);
        return;
    }

    // 2. Physical Construction: Pass our locally colored parts list into the builder
    const shipMesh = buildCustomShip(playerData.parts);
    shipMesh.name = `ship_${peerId}`;
    
    const shipPreset = SHIP_PRESETS[playerData.shipType];
    
    // Initialize HP Manager with stats from ship preset
    const hpManager = new HPManager(
        shipPreset.statistics.maxHP,
        shipPreset.statistics.shieldCapacity,
        shipPreset.statistics.shieldRegenDelay,
        shipPreset.statistics.hpRegenRate,
        shipPreset.statistics.maxRegenPercentage
    );

    shipMesh.userData = { 
        peerId, 
        isLocal: playerData.isLocal,
        hpManager: hpManager,
        isDead: false,
        deathTime: null,
        targetScene: targetScene
    };

    const engineLight = new THREE.PointLight(shipPreset.statistics.engineColor, 5, 70, 0.3);
    engineLight.position.set(0, 0, -10);
    shipMesh.add(engineLight);
    shipMesh.userData.engineLight = engineLight; // Expose for debug controls
    
    // Find a safe spawn location that doesn't collide with asteroids
    const safeSpawnPos = findSafeSpawnLocation(
        targetScene,
        new THREE.Vector3(playerData.x, playerData.y, playerData.z),
        100,
        playerData.shipType || 'viking1'
    );
    shipMesh.position.set(safeSpawnPos.x, safeSpawnPos.y, safeSpawnPos.z);
    targetScene.add(shipMesh);

    //initializeShipTrails(targetScene, playerData, shipMesh, playerData.isLocal ? '#4ba8ff' : '#ff0055');

    // 3. Initialize weapons for local player, or register remote ship as targetable
    if (playerData.isLocal) {
        localPlayerShip = shipMesh;
        localPlayerWeapons = new WeaponManager(shipMesh, playerData.shipType || 'viking1', globalBeamPool, targetScene);
        console.log(`[FLEET MANAGER]: Initialized weapons for local player (${playerData.shipType})`);
    } else {
        remoteShips[peerId] = shipMesh;
        // Register remote ship as a targetable enemy that can be shot at
        globalTargetManager.registerTarget(shipMesh, true);
        console.log(`[FLEET MANAGER]: Registered remote ship as targetable enemy: ${playerData.tag}`);
    }
    
    // 4. Setup HP callbacks
    if (playerData.isLocal) {
        // Set up death callback for local player
        hpManager.onDeath = (position) => {
            console.log(`[FLEET MANAGER]: Local player died!`);
            shipMesh.userData.isDead = true;
            shipMesh.userData.deathTime = performance.now() / 1000;
            respawnTimers.set(peerId, { deathTime: shipMesh.userData.deathTime, respawnDelay: RESPAWN_DELAY });
            // Despawn the ship immediately
            despawnShip(peerId, targetScene);
            // Trigger explosion effect (will be handled in game loop)
        };
    } else {
        // Remote player death handling
        hpManager.onDeath = (position) => {
            console.log(`[FLEET MANAGER]: Remote player ${playerData.tag} died`);
            shipMesh.userData.isDead = true;
            shipMesh.userData.deathTime = performance.now() / 1000;
            respawnTimers.set(peerId, { deathTime: shipMesh.userData.deathTime, respawnDelay: RESPAWN_DELAY });
            // Despawn the ship immediately when remote player dies
            despawnShip(peerId, targetScene);
        };
    }

    console.log(`[FLEET MANAGER]: Materialized ship for: ${playerData.tag} (Local: ${playerData.isLocal})`);
}

/**
 * Respawns a dead ship at a safe location with full HP and shield
 * @param {string} peerId - Peer ID of ship to respawn
 * @param {THREE.Scene} targetScene - Scene to respawn in
 */
export function respawnShip(peerId, targetScene) {
    const mesh = localPlayerShip?.userData.peerId === peerId ? localPlayerShip : remoteShips[peerId];
    const playerData = gameState.players[peerId];

    if (!playerData) {
        console.warn(`[FLEET MANAGER]: Cannot respawn ship ${peerId} - player data missing`);
        return;
    }

    // Find a safe spawn location
    const safeSpawnPos = findSafeSpawnLocation(
        targetScene,
        new THREE.Vector3(playerData.x, playerData.y, playerData.z),
        100,
        playerData.shipType || 'viking1'
    );

    // If mesh doesn't exist (was despawned), we need to re-create or restore it
    if (!mesh) {
        // This is a despawned ship being respawned - re-add it to the scene
        spawnSingleShip(peerId, targetScene);
        
        // Get the newly created mesh (could be local or remote)
        const newMesh = localPlayerShip?.userData.peerId === peerId ? localPlayerShip : remoteShips[peerId];
        if (newMesh) {
            // The new mesh was already positioned in spawnSingleShip
            // Just ensure the HP/state is properly reset
            newMesh.userData.isDead = false;
            newMesh.userData.deathTime = null;
            console.log(`[FLEET MANAGER]: Respawned despawned ship for ${playerData.tag}`);
        }
    } else {
        // Mesh still exists - reuse it by restoring scale and re-enabling matrix updates
        mesh.matrixAutoUpdate = true;  // Re-enable matrix updates for new position
        mesh.traverse((child) => {
            child.matrixAutoUpdate = true;  // Re-enable for all children too
        });
        mesh.scale.set(1, 1, 1);       // Restore to full size (make visible again)
        mesh.position.set(safeSpawnPos.x, safeSpawnPos.y, safeSpawnPos.z);
        mesh.updateMatrix();           // Force immediate matrix update
        mesh.userData.hpManager.respawn();
        mesh.userData.isDead = false;
        mesh.userData.deathTime = null;

        // Re-register as targetable if remote ship
        if (!playerData.isLocal) {
            globalTargetManager.registerTarget(mesh, true);
        }
        
        console.log(`[FLEET MANAGER]: Respawned existing ship for ${playerData.tag}`);
    }

    respawnTimers.delete(peerId);

    // The HOST broadcasts respawn location to all players (both local and remote)
    // This ensures clients receive the PLAYER_RESPAWN message with the respawn coordinates
    if (gameState.meta.isHost) {
        const finalPos = localPlayerShip?.userData.peerId === peerId 
            ? localPlayerShip.position 
            : remoteShips[peerId]?.position || new THREE.Vector3();
        broadcastPlayerRespawn(peerId, finalPos.x, finalPos.y, finalPos.z);
    }

    console.log(`[FLEET MANAGER]: Respawned ship for ${playerData.tag} (Local: ${playerData.isLocal})`);
}

/**
 * Broadcasts the local player's respawn location to all other players
 * @param {string} peerId - Peer ID of the respawning player
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} z - Z coordinate
 */
export function broadcastPlayerRespawn(peerId, x, y, z) {
    if (broadcastToAll) {
        broadcastToAll({ 
            type: 'PLAYER_RESPAWN', 
            peerId, 
            x: Math.round(x * 100) / 100,  // Round to 2 decimals to save bandwidth
            y: Math.round(y * 100) / 100,
            z: Math.round(z * 100) / 100
        });
        console.log(`[FLEET MANAGER]: Broadcast respawn location for ${peerId}`);
    }
}

/**
 * Update respawn timers and handle ship respawning
 * Called from the main game loop
 * @param {THREE.Scene} targetScene - The gameplay scene
 */
export function updateRespawnTimers(targetScene) {
    const currentTime = performance.now() / 1000;

    for (const [peerId, respawnData] of respawnTimers.entries()) {
        const timeSinceDeath = currentTime - respawnData.deathTime;

        if (timeSinceDeath >= respawnData.respawnDelay) {
            respawnShip(peerId, targetScene);
        }
    }
}

/**
 * SCENARIO B: Batches the entire lobby list at the initial gameplay transition threshold
 */
export function spawnFleet(targetScene) {
    console.log("⚓ Fleet Manager: Running full manifest assembly...");
    Object.keys(gameState.players).forEach(peerId => {
        spawnSingleShip(peerId, targetScene);
    });
}



/**
 * Despawns a ship by scaling it to 0 and freezing matrix updates (avoids GPU stall)
 * The mesh is reused on respawn with full scale restored.
 * @param {string} peerId 
 * @param {THREE.Scene} targetScene 
 */
export function despawnShip(peerId, targetScene) {
    // Handle both remote and local ships
    const mesh = remoteShips[peerId] || (localPlayerShip?.userData.peerId === peerId ? localPlayerShip : null);
    
    if (!mesh) {
        console.log(`[FLEET MANAGER]: No 3D asset found to despawn for peer: ${peerId}`);
        return;
    }

    // 1. Scale to 0 to hide (zero GPU cost, no visibility changes)
    mesh.scale.set(0, 0, 0);
    mesh.updateMatrix(); // Apply the scale transformation immediately
    
    // 2. Freeze matrix auto-update on mesh and all children to avoid recalculating transforms
    mesh.matrixAutoUpdate = false;
    mesh.traverse((child) => {
        child.matrixAutoUpdate = false;
    });
    
    // 3. Mark as dead in userData
    mesh.userData.isDead = true;

    // 4. Unregister from target manager so it can't be shot at anymore
    // Note: We keep the mesh in remoteShips/localPlayerShip so we can reuse it on respawn
    globalTargetManager.unregisterTarget(mesh);
    
    console.log(`❌ [FLEET MANAGER]: Despawned ship for peer: ${peerId} (scaled to 0, will be reused on respawn)`);
}

// clean up when disconnecting
export function purgeFleet(targetScene) {
    // 1. Purge all remote ships
    Object.keys(remoteShips).forEach(peerId => {
        
        despawnShip(peerId, targetScene);
    });

    // 2. Purge local ship
    if (localPlayerShip) {
        cleanupPlayerTrails(targetScene, gameState.players[localPlayerShip.userData.peerId]);
        targetScene.remove(localPlayerShip);
        localPlayerShip = null;
    }
    
    console.log("[FLEET MANAGER]: 3D scene and caches flushed.");
}


/**
 * Runs inside your animate3D requestAnimationFrame loop to update ship positions and HP
 * @param {number} deltaTime - seconds since last frame
 * @param {THREE.Camera} camera - Pass your active Three.js game camera here
 * @param {THREE.Scene} targetScene - The gameplay scene (for respawning)
 */
export function updateFleet(deltaTime, camera, targetScene = null) {
    // Local player syncing is now handled by movement.js

    // Smoothly interpolate/lerp remote client positions from network packets
    // Scale lerp factor with deltaTime to be frame-rate independent
    const lerpFactor = 1 - Math.exp(-20 * deltaTime); // Smooth lerp factor

    // Update all ships
    const allShips = Object.assign({}, remoteShips);
    if (localPlayerShip) {
        allShips[localPlayerShip.userData.peerId] = localPlayerShip;
    }

    Object.entries(allShips).forEach(([peerId, mesh]) => {
        if (!mesh || !mesh.userData || !mesh.userData.hpManager) return;

        // Update HP manager (regeneration, shield regen, etc.)
        mesh.userData.hpManager.update(deltaTime);

        // Update position for remote ships only
        const playerData = gameState.players[peerId];
        if (playerData && mesh !== localPlayerShip) {
            targetPosition.set(playerData.x, playerData.y, playerData.z);
            mesh.position.lerp(targetPosition, lerpFactor);
            
            // Also lerp rotation for remote ships with shortest angle interpolation
            // Uses getShortestAngleDifference to avoid 2π wrapping issues (360→0 looping)
            if (playerData.rotationX !== undefined && playerData.rotationY !== undefined && playerData.rotationZ !== undefined) {
                mesh.rotation.x += getShortestAngleDifference(mesh.rotation.x, playerData.rotationX) * lerpFactor;
                mesh.rotation.y += getShortestAngleDifference(mesh.rotation.y, playerData.rotationY) * lerpFactor;
                mesh.rotation.z += getShortestAngleDifference(mesh.rotation.z, playerData.rotationZ) * lerpFactor;
            }

            // Update remote ship visual effects (engine exhaust & aux thrusters)
            // Uses synced throttle and rotation delta directly from network
            
            // 1. Apply main engine exhaust flare using synced throttle
            const remoteThrottle = playerData.throttle || 0;
            updateShipThrustVisuals(mesh, remoteThrottle, deltaTime);
            
            // 2. Apply auxiliary thruster flares using synced rotation delta
            const rotationDelta = new THREE.Euler(
                playerData.deltaEulerX || 0,
                playerData.deltaEulerY || 0,
                playerData.deltaEulerZ || 0,
                'YXZ'
            );
            updateShipAuxVisuals(mesh, rotationDelta);



        }

    });

    // Update respawn timers if scene is provided
    if (targetScene) {
        updateRespawnTimers(targetScene);
    }

    //updateAllMultiplayerTrails(localPlayerShip, remoteShips, camera); // trails are not used yet
}
