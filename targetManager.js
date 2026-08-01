import * as THREE from 'three';
import { gameplayScene, camera } from './view3d.js';
import { globalAsteroidManager } from './asteroidManager.js';

/**
 * TargetManager: Centralized registry for all targetable objects in the game world
 * Handles:
 * - Registering/unregistering targetable objects (enemies, asteroids, ships, etc.)
 * - Finding the closest valid target within constraints (range, lock cone angle, line of sight)
 * - Managing target priorities
 */
export class TargetManager {
    constructor() {
        this.targetableObjects = []; // Array of { object: Mesh3D, isEnemy: boolean }
        this.scene = null; // Scene reference for line-of-sight raycasting
    }

    /**
     * Set the scene for line-of-sight calculations
     * @param {THREE.Scene} scene - The gameplay scene
     */
    setScene(scene) {
        this.scene = scene;
    }

    /**
     * Internal method: Check if there is a clear line of sight between origin and target
     * Raycasts to detect asteroids blocking the path
     * @param {THREE.Vector3} origin - Origin position
     * @param {THREE.Object3D} targetObject - The target object
     * @param {number} distance - Distance to target
     * @returns {boolean} True if line of sight is clear
     */
    checkLineOfSight(origin, targetObject, distance) {
        if (!this.scene) return true; // No scene, assume LoS is clear
        
        const dirToTarget = targetObject.position.clone().sub(origin).normalize();
        const raycaster = new THREE.Raycaster(origin, dirToTarget, 0, distance);

        // Get cached asteroids - O(1) lookup instead of O(n) traversal
        const asteroids = globalAsteroidManager.getAsteroids();

        for (const asteroid of asteroids) {
            const meshes = [];
            asteroid.traverse((child) => {
                if (child.isMesh) meshes.push(child);
            });

            if (meshes.length === 0) continue;

            const intersects = raycaster.intersectObjects(meshes, false);
            if (intersects.length > 0 && intersects[0].distance < distance) {
                return false; // Target is blocked
            }
        }

        return true; // No blocking objects, line of sight is clear
    }

    /**
     * Register an object as targetable in the system
     * @param {THREE.Object3D} object - The 3D object to make targetable
     * @param {boolean} isEnemy - Whether this object is an enemy/hostile target
     */
    registerTarget(object, isEnemy = true) {
        // Check if already registered
        const existing = this.targetableObjects.find(t => t.object === object);
        if (existing) {
            console.warn('[TARGET MANAGER]: Object already registered as targetable');
            return;
        }

        this.targetableObjects.push({
            object: object,
            isEnemy: isEnemy
        });

        console.log(`[TARGET MANAGER]: Registered targetable object (Enemy: ${isEnemy}). Total targets: ${this.targetableObjects.length}`);
    }

    /**
     * Unregister a targetable object from the system
     * @param {THREE.Object3D} object - The 3D object to unregister
     */
    unregisterTarget(object) {
        const index = this.targetableObjects.findIndex(t => t.object === object);
        if (index >= 0) {
            this.targetableObjects.splice(index, 1);
            console.log(`[TARGET MANAGER]: Unregistered targetable object. Remaining targets: ${this.targetableObjects.length}`);
        }
    }

    /**
     * Get all targetable enemies (optionally filtered by range)
     * @param {THREE.Vector3} originPos - Origin position to calculate range from
     * @param {number} maxRange - Optional max range filter
     * @returns {Array} Array of { object, distance } for all valid enemies
     */
    getTargetsInRange(originPos, maxRange = Infinity) {
        const validTargets = [];

        for (const targetEntry of this.targetableObjects) {
            if (!targetEntry.isEnemy) continue; // Only consider enemies
            
            // Skip dead or scaled-to-zero ships (avoids targeting despawned ships)
            if (targetEntry.object.userData?.isDead || targetEntry.object.scale.x === 0) {
                continue;
            }

            const targetPos = new THREE.Vector3();
            targetEntry.object.getWorldPosition(targetPos);
            const distance = originPos.distanceTo(targetPos);

            if (distance <= maxRange) {
                validTargets.push({
                    object: targetEntry.object,
                    distance: distance,
                    position: targetPos
                });
            }
        }

        // Sort by distance (closest first)
        validTargets.sort((a, b) => a.distance - b.distance);
        return validTargets;
    }

    /**
     * Find the closest targetable enemy that satisfies all constraints:
     * - Within max range
     * - Within lock angle cone from the given forward axis
     * - (Optional) Has clear line of sight
     *
     * @param {THREE.Vector3} originPos - Origin position (ship or camera position)
     * @param {THREE.Vector3} forwardAxis - Forward direction to measure lock cone against
     * @param {number} maxRange - Maximum targeting range
     * @param {number} lockAngleDegrees - Half-angle of targeting cone in degrees
     * @param {boolean} shouldCheckLineOfSight - Whether to perform line of sight checks. Default is false
     * @returns {Object|null} { object, distance, position } or null if no valid target found
     */
    findClosestTarget(originPos, forwardAxis, maxRange, lockAngleDegrees, shouldCheckLineOfSight = false) {
        const targetsInRange = this.getTargetsInRange(originPos, maxRange);

        if (targetsInRange.length === 0) {
            return null; // No targets in range
        }

        // Convert lock angle to radians
        const lockConeRad = lockAngleDegrees * Math.PI / 180;
        const cosConeAngle = Math.cos(lockConeRad);

        // Find the closest target that is also within the lock cone
        for (const target of targetsInRange) {
            const dirToTarget = target.position.clone().sub(originPos).normalize();

            // Check if within lock angle cone
            const dotProduct = dirToTarget.dot(forwardAxis.normalize());

            if (dotProduct <= cosConeAngle) {
                // Not within cone, skip
                continue;
            }

            // Check line of sight if requested
            if (shouldCheckLineOfSight) {
                const hasLineOfSight = this.checkLineOfSight(originPos, target.object, target.distance);
                if (!hasLineOfSight) {
                    // Blocked by obstacle, skip
                    continue;
                }
            }

            // This target passed all checks!
            return {
                object: target.object,
                distance: target.distance,
                position: target.position
            };
        }

        // No valid target found
        return null;
    }

    /**
     * Check if there is a valid target in the camera's lock cone
     * Uses camera position and forward axis
     * @param {THREE.Camera} cameraObj - The camera object
     * @param {number} lockAngleDegrees - Half-angle of targeting cone in degrees
     * @param {number} maxRange - Maximum targeting range
     * @param {boolean} shouldCheckLineOfSight - Whether to perform line of sight checks. Default is false
     * @returns {boolean} True if a valid target is found in camera lock cone
     */
    isCameraTargetInLockCone(cameraObj, lockAngleDegrees, maxRange, shouldCheckLineOfSight = false) {
        if (!cameraObj) return false;

        const cameraPos = cameraObj.position.clone();
        // Camera looks down -Z in world space
        const cameraForwardAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObj.quaternion);

        const target = this.findClosestTarget(
            cameraPos,
            cameraForwardAxis,
            maxRange,
            lockAngleDegrees,
            shouldCheckLineOfSight
        );

        return target !== null;
    }

    /**
     * Clear all registered targets
     * Useful for cleanup when transitioning scenes
     */
    clear() {
        this.targetableObjects = [];
        console.log('[TARGET MANAGER]: All targets cleared');
    }

    /**
     * Get count of registered targets
     * @returns {number} Number of targetable objects
     */
    getTargetCount() {
        return this.targetableObjects.length;
    }

    /**
     * Get count of registered enemies
     * @returns {number} Number of enemy targets
     */
    getEnemyCount() {
        return this.targetableObjects.filter(t => t.isEnemy).length;
    }
}

// Global target manager instance - accessible from anywhere in the app
export const globalTargetManager = new TargetManager();
