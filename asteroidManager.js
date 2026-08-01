/**
 * AsteroidManager - Centralized cache for all asteroids in the scene
 * 
 * This module maintains a cached list of asteroid references to eliminate
 * expensive O(n) scene traversals that were happening every frame in:
 * - Collision detection
 * - Target manager line-of-sight checks
 * 
 * Asteroids are registered when created and unregistered when removed,
 * keeping the cache always in sync without frame-time overhead.
 */

class AsteroidManager {
    constructor() {
        this.asteroids = []; // Cached array of asteroid references
    }

    /**
     * Register an asteroid with the manager
     * Called by asteroidGenerator when creating new asteroids
     * @param {THREE.Object3D} asteroidMesh - The asteroid object to register
     */
    registerAsteroid(asteroidMesh) {
        if (!asteroidMesh) return;
        
        // Avoid duplicates
        if (this.asteroids.includes(asteroidMesh)) {
            console.warn('[ASTEROID MANAGER]: Attempted to register duplicate asteroid');
            return;
        }
        
        this.asteroids.push(asteroidMesh);
    }

    /**
     * Unregister an asteroid from the manager
     * Called when an asteroid is removed from the scene
     * @param {THREE.Object3D} asteroidMesh - The asteroid object to unregister
     */
    unregisterAsteroid(asteroidMesh) {
        if (!asteroidMesh) return;
        
        const index = this.asteroids.indexOf(asteroidMesh);
        if (index >= 0) {
            this.asteroids.splice(index, 1);
        }
    }

    /**
     * Get all registered asteroids
     * This is a cached reference - O(1) access, no traversal needed
     * @returns {Array} Array of asteroid mesh objects
     */
    getAsteroids() {
        return this.asteroids;
    }

    /**
     * Get count of active asteroids
     * @returns {number} Number of registered asteroids
     */
    getAsteroidCount() {
        return this.asteroids.length;
    }

    /**
     * Clear all asteroids from cache
     * Useful for scene reset/cleanup
     */
    clear() {
        this.asteroids = [];
    }
}

// Global singleton instance
export const globalAsteroidManager = new AsteroidManager();
