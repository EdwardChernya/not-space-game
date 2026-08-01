// ============================================================================
// CANNON WEAPON - Represents a single gun hardpoint
// ============================================================================

import * as THREE from 'three';
import { gameState } from '../gameState.js';
import { globalSparkPool } from '../particleEffects.js';
import { globalAsteroidManager } from '../asteroidManager.js';

let connectionFn = null;      // Getter: returns current connection object
let broadcastToAllRef = null;  // Direct function reference

export function setCannonWeaponDependencies(connectionGetter, broadcastToAll) {
    connectionFn = connectionGetter;
    broadcastToAllRef = broadcastToAll;
}

export class CannonWeapon {
    /**
     * @param {THREE.Mesh} gunMesh - The gun mesh (gun_L or gun_R)
     * @param {Object} config - Weapon configuration
     * @param {number} gunIndex - Index of this gun (0, 1, etc.) for staggered firing
     * @param {THREE.Mesh} shipMesh - The ship mesh (for peerId extraction)
     */
    constructor(gunMesh, config = {}, gunIndex = 0, shipMesh = null) {
        this.gunMesh = gunMesh;
        this.shipMesh = shipMesh;
        
        // Weapon properties (exposed for configuration)
        this.fireRate = config.fireRate || 10; // Shots per second
        this.maxRange = config.maxRange || 500;
        this.lockAngleDegrees = config.lockAngleDegrees || 20; // Half-angle of target lock cone in degrees
        // Color is now provided directly via config.color (set at WeaponManager initialization)
        this.color = new THREE.Color(config.color !== undefined ? config.color : 0xffff00);
        this.brightness = config.brightness || 1.0;
        
        // Fire timing - stagger guns so they don't fire simultaneously
        this.fireCooldown = 1.0 / this.fireRate; // Seconds between shots
        // Gun 0 can fire immediately, Gun 1 starts on cooldown to stagger fire
        this.lastFireTime = gunIndex === 0 ? 0 : this.fireCooldown;
        
        // Pre-calculate and cache lock cone values to avoid repeated Math.PI divisions per shot
        this._lockConeRad = (this.lockAngleDegrees * Math.PI) / 180;
        this._cosLockAngle = Math.cos(this._lockConeRad);
        
        // Temp vectors for performance (reused across shots to avoid allocations)
        this._worldPos = new THREE.Vector3();
        this._worldDirection = new THREE.Vector3();
        this._targetPos = new THREE.Vector3();
        this._dirToTarget = new THREE.Vector3();
        this._aimDirection = new THREE.Vector3();
        this._aimDirectionForBeam = new THREE.Vector3();
        
        // Reuse single raycaster instance instead of creating new one per shot
        this._raycaster = new THREE.Raycaster();
    }

    canFire(currentTime) {
        // Check if enough time has passed since last fire
        return (currentTime - this.lastFireTime) >= this.fireCooldown;
    }

    /**
     * Fire the cannon in the given direction
     * @param {THREE.Vector3} shipForwardAxis - The ship's forward direction (world space)
     * @param {THREE.Scene} scene - Scene for raycasting
     * @param {BeamPool} beamPool - Visual effect pool
     * @param {number} currentTime - Current time in seconds
     * @param {THREE.Mesh} targetMesh - Optional target mesh for aim direction
     * @param {number} lockAngle - Cone angle in degrees for target lock (default 60)
     * @param {boolean} isTargetLocked - Whether target is confirmed locked with line of sight clear
     * @param {number} damageAmount - Damage this shot will deal
     * @returns {Object|null} Hit data {hitPoint, distance, asteroid} or null
     */
    fire(shipForwardAxis, scene, beamPool, currentTime, targetMesh = null, lockAngle = 60, isTargetLocked = false, damageAmount = 25) {
        if (!this.canFire(currentTime)) return null;

        // Get gun world position (reuse pre-allocated vector)
        this.gunMesh.getWorldPosition(this._worldPos);

        // Calculate aim direction (target-aware if target is available and in lock angle)
        this._aimDirection.copy(shipForwardAxis).normalize();
        this._aimDirectionForBeam.copy(this._aimDirection);
        
        // Prepare target lock angle cone calculation (use cached values if matching)
        let lockConeRad = this._lockConeRad;
        let cosLockAngle = this._cosLockAngle;
        
        // If lockAngle parameter differs from constructor value, recalculate
        if (Math.abs(lockAngle - this.lockAngleDegrees) > 0.01) {
            lockConeRad = lockAngle * Math.PI / 180;
            cosLockAngle = Math.cos(lockConeRad);
        }
        
        // Single target position lookup (reuse pre-allocated vector)
        if (targetMesh) {
            targetMesh.getWorldPosition(this._targetPos);
            this._dirToTarget.copy(this._targetPos).sub(this._worldPos).normalize();
            
            // Check if target is within lock angle cone
            const dotProduct = this._dirToTarget.dot(this._aimDirection);
            
            if (dotProduct > cosLockAngle) {
                // Target is within lock angle, aim at target
                this._aimDirection.copy(this._dirToTarget);
                this._aimDirectionForBeam.copy(this._dirToTarget);
            }
        }

        // Perform raycast (only if NOT targeting a locked target)
        let closestHit = null;
        let closestDistance = Infinity;

        // If target is NOT locked, perform normal raycast against asteroids
        if (!isTargetLocked) {
            // Use cached asteroids instead of scene traversal (O(1) instead of O(n))
            const asteroids = globalAsteroidManager.getAsteroids();
            
            // Configure raycaster with the aim direction (use pre-allocated vector)
            this._raycaster.set(this._worldPos, this._aimDirection);
            this._raycaster.far = this.maxRange;

            for (const asteroid of asteroids) {
                const meshes = [];
                asteroid.traverse((child) => {
                    if (child.isMesh) meshes.push(child);
                });

                if (meshes.length === 0) continue;

                const intersects = this._raycaster.intersectObjects(meshes, false);
                if (intersects.length > 0) {
                    const hit = intersects[0];
                    if (hit.distance < closestDistance) {
                        closestDistance = hit.distance;
                        closestHit = {
                            point: hit.point.clone(),
                            distance: hit.distance,
                            asteroid: asteroid,
                            normal: hit.face.normal.clone().applyMatrix3(
                                new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
                            ).normalize()
                        };
                    }
                }
            }
        }

        // Create beam visual
        let endPos;

        // If we have a target mesh and are aiming at it, always snap beam to target's center
        if (targetMesh) {
            // Reuse pre-calculated values from earlier in fire()
            const dotProduct = this._dirToTarget.dot(this._aimDirection);
            
            if (dotProduct > cosLockAngle) {
                // We're aiming at the target, snap beam to its center (reuse cached position)
                endPos = this._targetPos;
            } else {
                // Not aiming at target, use raycast result or default range
                endPos = closestHit
                    ? closestHit.point
                    : this._aimDirectionForBeam.clone().multiplyScalar(this.maxRange).add(this._worldPos);
            }
        } else {
            // No target, use raycast result or default range
            endPos = closestHit
                ? closestHit.point
                : this._aimDirectionForBeam.clone().multiplyScalar(this.maxRange).add(this._worldPos);
        }

         if (beamPool) {
             // Use weapon's configured color
             // isLocalBeam: true = no hold phase, retract immediately for responsive feel
             beamPool.get(this._worldPos, endPos, this.color, this.brightness, true);
             
             // Determine hit information for network transmission
             let hasHit = false;
             let impactPos = null;
             
             if (isTargetLocked && targetMesh) {
                 // Locked target hit - beam hits at target center
                 hasHit = true;
                 const targetPos = new THREE.Vector3();
                 targetMesh.getWorldPosition(targetPos);
                 impactPos = targetPos;
             } else if (closestHit) {
                 // Asteroid hit - beam hits at collision point
                 hasHit = true;
                 impactPos = closestHit.point;
             }
             
             // Network sync: Send beam information to other players
             this.sendBeamToNetwork(
                 this._worldPos,
                 endPos,
                 targetMesh,
                 this.color,
                 this.brightness,
                 hasHit,
                 impactPos
             );
         }

         // Spawn hit particle effect
         const particleColor = this.color;
         
         if (isTargetLocked && targetMesh) {
             // When target is locked: spawn particles at target location (guaranteed hit)
             // Reuse cached target position to avoid new Vector3 allocation
             globalSparkPool.spawnBurst(
                 this._targetPos,    // Position at target center (reuse cached)
                 particleColor,      // Use beam color for particles
                 15,                 // 15 particles per hit
                 65                  // Spread velocity
             );

             // DAMAGE: Route through network authority model
             // - Client in multiplayer: send damage request to host (host is authoritative)
             // - Host or solo: apply damage directly
             if (targetMesh.userData && targetMesh.userData.hpManager) {
                 const targetPeerId = targetMesh.userData.peerId;
                 const conn = connectionFn ? connectionFn() : null;
                 if (gameState.meta.isMultiplayer && !gameState.meta.isHost && conn && conn.open) {
                     // Client sends damage event to host for authoritative processing
                     conn.send({
                         type: 'DAMAGE_TAKEN',
                         shooterPeerId: this.shipMesh?.userData?.peerId,
                         targetPeerId: targetPeerId,
                         damageAmount: damageAmount
                     });
                  } else if (gameState.meta.isHost || !gameState.meta.isMultiplayer) {
                      // Host or solo: apply damage directly as the authority
                      const damageResult = targetMesh.userData.hpManager.takeDamage(damageAmount, this._targetPos);

                      if (damageResult && damageResult.isDead && this.shipMesh?.userData?.hpManager) {
                          this.shipMesh.userData.hpManager.triggerKillFeedback();
                      }
                      
                       // If in multiplayer and we're the host, broadcast the damage to all clients
                       if (damageResult && gameState.meta.isMultiplayer && broadcastToAllRef) {
                           const hpManager = targetMesh.userData.hpManager;
                           
                           // Broadcast health update to all clients
                           broadcastToAllRef({
                               type: 'HEALTH_UPDATE',
                               peerId: targetPeerId,
                               currentHP: hpManager.currentHP,
                               currentShield: hpManager.currentShield,
                               maxHP: hpManager.maxHP,
                               maxShield: hpManager.maxShield,
                               wasJustDamaged: true
                           });
                          
                          // If target died, broadcast death notification and kill feedback
                          if (damageResult.isDead) {
                              console.log(`[NETWORK]: Host killed player ${targetPeerId}`);
                              broadcastToAllRef({
                                  type: 'PLAYER_DIED',
                                  peerId: targetPeerId
                              });
                              broadcastToAllRef({
                                  type: 'KILL_FEEDBACK',
                                  shooterPeerId: this.shipMesh?.userData?.peerId,
                                  targetPeerId: targetPeerId
                              });
                          }
                      }
                  }
             }
         } else if (closestHit) {
             // When target is NOT locked: spawn particles at raycast impact point
             globalSparkPool.spawnBurst(
                 closestHit.point,  // Position at impact point
                 particleColor,     // Use beam color for particles
                 15,                // 15 particles per hit
                 65                 // Spread velocity
             );
         }

         // Mark as fired
         this.lastFireTime = currentTime;

         return closestHit;
    }

    /**
     * Send beam information to network for other players to render
     * @param {THREE.Vector3} startPos - Start position of beam (gun position)
     * @param {THREE.Vector3} endPos - End position of beam
     * @param {THREE.Mesh} targetMesh - Optional target mesh
     * @param {THREE.Color} color - Beam color
     * @param {number} intensity - Beam intensity/brightness
     * @param {boolean} hasHit - Whether the beam hit a target or asteroid
     * @param {THREE.Vector3} impactPos - Position where the beam impacted
     */
    sendBeamToNetwork(startPos, endPos, targetMesh, color, intensity, hasHit = false, impactPos = null) {
        // Only send if in multiplayer mode
        if (!gameState.meta.isMultiplayer) return;

        const conn = connectionFn ? connectionFn() : null;
        const shooterPeerId = this.shipMesh?.userData?.peerId; // Get peerId from stored ship mesh reference
        
        if (!shooterPeerId) return; // Can't send if we don't know our own peerId

        // Convert color to hex for network transmission
        const colorHex = typeof color === 'object' ? color.getHex() : color;

        let beamMessage = {
            type: 'BEAM_FIRED',
            shooterPeerId: shooterPeerId,
            color: colorHex,
            intensity: intensity,
            // Always include the gun position (start position) so remote clients know exact origin
            startPos: [startPos.x, startPos.y, startPos.z],
            hasHit: hasHit
        };

        // Add impact position if beam hit something
        if (hasHit && impactPos) {
            beamMessage.impactPos = [impactPos.x, impactPos.y, impactPos.z];
        }

        // If targeting a specific ship, send targetPeerId
        if (targetMesh && targetMesh.userData && targetMesh.userData.peerId) {
            beamMessage.targetPeerId = targetMesh.userData.peerId;
            // Also include endPos for targeted beams (the target's position at time of fire)
            beamMessage.endPos = [endPos.x, endPos.y, endPos.z];
        } else {
            // Untargeted beam: send absolute end position as well
            beamMessage.endPos = [endPos.x, endPos.y, endPos.z];
        }

        // Send beam to network
        if (gameState.meta.isHost && broadcastToAllRef) {
            // Host broadcasts to all clients
            broadcastToAllRef(beamMessage);
        } else if (!gameState.meta.isHost && conn && conn.open) {
            // Client sends to host (host will broadcast)
            conn.send(beamMessage);
        }
    }
}
