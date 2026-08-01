// ============================================================================
// WEAPON MANAGER - Manages all weapons for a ship
// ============================================================================

import * as THREE from 'three';
import { gameState, getShipPreset } from '../gameState.js';
import { globalSparkPool } from '../particleEffects.js';
import { globalTargetManager } from '../targetManager.js';
import { CannonWeapon } from './cannonWeapon.js';

let targetManagerSceneSet = false;

export class WeaponManager {
    /**
     * @param {THREE.Group} shipMesh - The ship visual mesh
     * @param {string} shipType - Type of ship (e.g. 'viking1')
     * @param {BeamPool} beamPool - Shared beam pool
     * @param {THREE.Scene} scene - Scene for raycasting
     * @param {THREE.Mesh} targetMesh - Optional target mesh for weapon aiming
     */
    constructor(shipMesh, shipType = 'viking1', beamPool = null, scene = null, targetMesh = null) {
        this.shipMesh = shipMesh;
        this.shipType = shipType;
        this.beamPool = beamPool;
        this.scene = scene;
        this.targetMesh = targetMesh;
        this.weapons = [];
        this.currentGunIndex = 0; // For alternating fire
        this.isFiring = false;
        
        // Shared cooldown timer for alternating fire pattern
        this.lastShotTime = 0;
        this.sharedFireCooldown = 0.5; // Default: 2 shots per second total (0.5s per shot)

        // Initialize particle pool with scene for hit effects
        if (scene) {
            globalSparkPool.setScene(scene);
            // Set scene for target manager's line-of-sight calculations
            if (!targetManagerSceneSet) {
                globalTargetManager.setScene(scene);
                targetManagerSceneSet = true;
            }
        }

        this.initializeWeapons(shipType);
    }

    initializeWeapons(shipType) {
        if (shipType === 'viking1') {
            // Find gun meshes on the ship
            const gunL = this.shipMesh.getObjectByName('viking1_gun_L');
            const gunR = this.shipMesh.getObjectByName('viking1_gun_R');
            const shipPreset = getShipPreset(shipType);
            const lockAngle = shipPreset?.statistics?.lockAngleDegrees || 20; // Default to 20 if not defined
            const weaponRange = shipPreset?.statistics?.range || 500; // Default to 500 if not defined
            const color = shipPreset?.statistics?.gunColor || '#ffff00'; // Default to yellow if not defined
            const weaponFireRate = shipPreset?.statistics?.weaponFireRate || 6; // Default to 6 shots/sec if not defined

            if (gunL) {
                this.weapons.push(new CannonWeapon(gunL, {
                    fireRate: weaponFireRate,
                    maxRange: weaponRange,
                    color: color,
                    brightness: 1.65,
                    lockAngleDegrees: lockAngle
                }, 0, this.shipMesh)); // Gun index 0 - fires first, pass shipMesh
            }

            if (gunR) {
                this.weapons.push(new CannonWeapon(gunR, {
                    fireRate: weaponFireRate,
                    maxRange: weaponRange,
                    color: color,
                    brightness: 1.65,
                    lockAngleDegrees: lockAngle
                }, 1, this.shipMesh)); // Gun index 1 - fires second (staggered), pass shipMesh
            }
        }
        // Add other ship types here as needed
    }

    /**
     * Fire weapons if able (alternating gun pattern)
     * Uses a shared cooldown timer to fire guns in strict alternation.
     * Each gun fires in turn, respecting the shared fire rate cooldown.
     * Automatically finds the closest valid target using the global target manager.
     * @param {THREE.Vector3} shipForwardAxis - Ship forward direction
     * @param {number} currentTime - Current time in seconds
     * @returns {Object|null} Hit data from fired weapon
     */
    tryFire(shipForwardAxis, currentTime) {
        if (this.weapons.length === 0) return null;

        const weapon = this.weapons[this.currentGunIndex];
        this.sharedFireCooldown = 1 / weapon.fireRate; // Update shared cooldown based on current gun's fire rate

        // Check if enough time has passed since the last shot (shared cooldown)
        if ((currentTime - this.lastShotTime) < this.sharedFireCooldown) {
            return null; // Still on cooldown
        }

        // Get ship position for targeting calculations
        const shipPos = new THREE.Vector3();
        this.shipMesh.getWorldPosition(shipPos);

        // Find the closest targetable enemy using the global target manager
        const targetInfo = globalTargetManager.findClosestTarget(
            shipPos,
            shipForwardAxis,
            weapon.maxRange,
            weapon.lockAngleDegrees,
            true  // Enable line of sight checking
        );

        // Determine if we have a valid locked target
        const isTargetLocked = targetInfo !== null;
        let targetForFire = isTargetLocked ? targetInfo.object : null;
        
        // Get gun damage from this ship's stats
        const peerId = this.shipMesh.userData?.peerId;
        const playerData = peerId ? gameState.players[peerId] : null;
        const damageAmount = playerData?.shipStats?.gunDamage || 25; // Default to 25 if not found
        
        // Fire the current gun, passing the lock status and target
        const hit = weapon.fire(
            shipForwardAxis,
            this.scene,
            this.beamPool,
            currentTime,
            targetForFire,
            weapon.lockAngleDegrees,
            isTargetLocked,  // Pass the lock status to skip raycast and guarantee hit
            damageAmount     // Pass the damage amount from shipStats
        );
        
        // Record the shot time and advance to next gun
        this.lastShotTime = currentTime;
        this.currentGunIndex = (this.currentGunIndex + 1) % this.weapons.length;
        
        return hit;
    }

    /**
     * Update weapon systems (visual effects, etc.)
     */
    update() {
        if (this.beamPool) {
            this.beamPool.update();
        }
    }

    /**
     * Set firing state
     */
    setFiring(isFiring) {
        this.isFiring = isFiring;
    }

    /**
     * Configure weapon properties
     */
    configureWeapon(weaponIndex, config) {
        if (weaponIndex < 0 || weaponIndex >= this.weapons.length) return;
        const weapon = this.weapons[weaponIndex];
        if (config.fireRate !== undefined) weapon.fireRate = config.fireRate;
        if (config.maxRange !== undefined) weapon.maxRange = config.maxRange;
        if (config.color !== undefined) weapon.color = new THREE.Color(config.color);
        if (config.brightness !== undefined) weapon.brightness = config.brightness;
        if (config.fireRate !== undefined) weapon.fireCooldown = 1.0 / config.fireRate;
    }

    configureAllWeapons(config) {
        this.weapons.forEach((_, idx) => this.configureWeapon(idx, config));
    }
}
