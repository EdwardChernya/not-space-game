import * as THREE from 'three';
import { velocity } from './movement.js';
import { globalAsteroidManager } from './asteroidManager.js';

/**
 * Configuration for collision response
 */
const COLLISION_CONFIG = {
    shipCollisionRadius: 3,    // Collision radius of the player ship
    bounceCoefficient: 0.3,    // Multiplier for bounce velocity (1.0 = full velocity, 0.5 = half, 0.33 = one third)
    broadPhaseMargin: 1.2,     // Safety margin for broad-phase check
    cooldownTime: 0.01         // Minimum time between collisions with same asteroid
};

// Track collision cooldowns per ship-asteroid pair
const collisionCooldowns = new Map();

/**
 * Gets or creates a cooldown tracker for a ship-asteroid pair
 */
function getCollisionKey(shipId, asteroidIndex) {
    return `${shipId}_${asteroidIndex}`;
}

/**
 * Checks if a collision is on cooldown
 */
function isOnCooldown(shipId, asteroidIndex, currentTime) {
    const key = getCollisionKey(shipId, asteroidIndex);
    const lastCollisionTime = collisionCooldowns.get(key);
    
    if (!lastCollisionTime) return false;
    
    return (currentTime - lastCollisionTime) < COLLISION_CONFIG.cooldownTime;
}

/**
 * Sets cooldown for a ship-asteroid collision
 */
function setCooldown(shipId, asteroidIndex, currentTime) {
    const key = getCollisionKey(shipId, asteroidIndex);
    collisionCooldowns.set(key, currentTime);
}

/**
 * Main collision detection function - runs every frame
 * Checks local player ship against all asteroids in the scene
 * 
 * @param {THREE.Object3D} localPlayerShip - The local player's ship mesh
 * @param {THREE.Scene} gameplayScene - The gameplay scene containing asteroids
 * @param {number} deltaTime - Delta time since last frame (seconds)
 */
export function checkCollisions(localPlayerShip, gameplayScene, deltaTime = 0) {
    if (!localPlayerShip) return;

    const shipPos = localPlayerShip.position;
    const currentTime = performance.now() / 1000; // Convert to seconds
    
    // Get cached asteroids - O(1) lookup instead of O(n) traversal
    const asteroids = globalAsteroidManager.getAsteroids();

    // Check collisions against each asteroid
    asteroids.forEach((asteroid, index) => {
        const asteroidPos = asteroid.position;
        const collisionRadius = asteroid.userData.collisionRadius;

        // ============================================================================
        // PHASE 1: BROAD-PHASE COLLISION CHECK (Distance-based)
        // ============================================================================
        const distance = shipPos.distanceTo(asteroidPos);
        const combinedRadius = (COLLISION_CONFIG.shipCollisionRadius + collisionRadius) * COLLISION_CONFIG.broadPhaseMargin;

        if (distance > combinedRadius) {
            // No collision in broad-phase
            return;
        }
        

        // Check cooldown to prevent rapid repeated collisions
        if (isOnCooldown(localPlayerShip.userData.peerId || 'local', index, currentTime)) {
            return;
        }

        // ============================================================================
        // PHASE 2: NARROW-PHASE COLLISION CHECK (BVH Raycast)
        // ============================================================================
        const collision = performBVHCollisionCheck(shipPos, asteroid, deltaTime);

        if (!collision) {
            // No precise collision detected
            return;
        }
        

        // ============================================================================
        // COLLISION RESPONSE: Apply bounce physics
        // ============================================================================
        setCooldown(localPlayerShip.userData.peerId || 'local', index, currentTime);
        applyBounceResponse(localPlayerShip, collision.point, collision.normal);

    });
}

/**
 * Performs precise BVH-based collision detection using raycasting
 * Shoots a ray from the ship toward the asteroid and checks for hits
 * 
 * @param {THREE.Vector3} shipPos - Ship position
 * @param {THREE.Object3D} asteroid - Asteroid mesh
 * @returns {Object|null} - Collision data with {point, normal} or null if no hit
 */
function performBVHCollisionCheck(shipPos, asteroid, deltaTime) {
    const speed = velocity.length();
    if (speed < 0.001) return null; // Skip if ship is almost stationary
    
    
    // Direction from ship velocity (normalized)
    const direction = velocity.clone().normalize();

    // dynamic distance based on speed, with a minimum threshold
    const movementDistance = speed * deltaTime;
    const maxDistance = COLLISION_CONFIG.shipCollisionRadius + movementDistance;

    const raycaster = new THREE.Raycaster(shipPos, direction, 0, maxDistance);
    
    // Check each mesh in the asteroid group
    const meshes = [];
    asteroid.traverse((child) => {
        if (child.isMesh) meshes.push(child);
    });

    if (meshes.length === 0) return null;

    const intersects = raycaster.intersectObjects(meshes, false);

    if (intersects.length > 0) {
        const hit = intersects[0]; // First hit is closest
        
        if (hit.distance <= COLLISION_CONFIG.shipCollisionRadius + movementDistance) {   
            // Return collision data with contact point and surface normal
            return {
                point: hit.point.clone(),
                normal: hit.face.normal.clone().applyMatrix3(
                    new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
                ).normalize(),
                distance: hit.distance
            };
        }
    }

    return null;
}

/**
 * Applies a bounce response to the ship based on collision contact point and normal
 * Pushes the ship away from the collision surface
 * 
 * @param {THREE.Object3D} ship - Ship to apply bounce to
 * @param {THREE.Vector3} contactPoint - Point of collision in world space
 * @param {THREE.Vector3} surfaceNormal - Surface normal at collision point
 */
function applyBounceResponse(ship, contactPoint, surfaceNormal) {
    // Calculate bounce direction - normalize the surface normal
    const bounceDir = surfaceNormal.clone().normalize();

    // Calculate relative velocity component along the bounce direction
    const velocityAlongNormal = velocity.dot(bounceDir);

    // Only bounce if moving toward the surface
    if (velocityAlongNormal < 0) {
        // Remove the component of velocity along the normal
        const velocityTangent = new THREE.Vector3().copy(velocity)
            .addScaledVector(bounceDir, -velocityAlongNormal);

        // Apply bounce force equal to the velocity component being reflected
        // Scaled by bounceCoefficient to control bounce strength
        const bounceImpulse = bounceDir.clone().multiplyScalar(-velocityAlongNormal * COLLISION_CONFIG.bounceCoefficient);

        // Combine tangential velocity with bounce impulse
        velocity.copy(velocityTangent).add(bounceImpulse);

    }

    // Push ship away from contact point to prevent clipping
    const pushAwayDistance = 0.2; // Small distance to separate from surface
    const pushAwayVector = bounceDir.clone().multiplyScalar(pushAwayDistance);
    ship.position.add(pushAwayVector);
}

/**
 * Clears all collision cooldowns (useful for scene resets)
 */
export function clearCollisionCooldowns() {
    collisionCooldowns.clear();
}
